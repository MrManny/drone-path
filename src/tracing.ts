import type { Span as ApiSpan, Tracer as ApiTracer } from '@opentelemetry/api';
import type * as OtelApiModule from '@opentelemetry/api';
import type { SpanExporter } from '@opentelemetry/sdk-trace';

import { errorMessage } from './errors.js';
import { VERSION } from './version.js';

type OtelApi = typeof OtelApiModule;

export type SpanValue = string | number | boolean;

export interface Span {
  setAttribute(name: string, value: SpanValue): void;
  setAttributes(values: Record<string, SpanValue>): void;
  fail(error: unknown): void;
  end(): void;
  readonly raw?: ApiSpan;
}

export interface StartSpanOptions {
  attributes?: Record<string, SpanValue>;
  parent?: Span;
}

export interface Tracer {
  startSpan(name: string, options?: StartSpanOptions): Span;
}

export interface TraceContext {
  tracer: Tracer;
  parent?: Span;
}

export interface Tracing {
  enabled: boolean;
  tracer: Tracer;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

type Env = Record<string, string | undefined>;

const SERVICE_NAME = 'drone-path';
const OTLP_PROTOCOL = 'http/protobuf';

const noopSpan: Span = {
  setAttribute: () => {},
  setAttributes: () => {},
  fail: () => {},
  end: () => {},
};

export const NOOP_TRACER: Tracer = {
  startSpan: () => noopSpan,
};

function envFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function envText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function isTracingEnabled(env: Env = process.env): boolean {
  const endpoint =
    envText(env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']) ??
    envText(env['OTEL_EXPORTER_OTLP_ENDPOINT']);
  return endpoint !== undefined && !envFlag(env['OTEL_SDK_DISABLED']);
}

// Per OTLP spec the specific endpoint is used as-is; the generic one is a base URL that gets /v1/traces.
export function otlpTracesUrl(env: Env): string | undefined {
  const specific = envText(env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']);
  if (specific) return specific;
  const base = envText(env['OTEL_EXPORTER_OTLP_ENDPOINT']);
  return base ? `${base.replace(/\/+$/, '')}/v1/traces` : undefined;
}

function parseKeyValueList(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (value ?? '').split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const rawValue = pair.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch {
      out[key] = rawValue;
    }
  }
  return out;
}

export function otlpHeaders(env: Env): Record<string, string> {
  return {
    ...parseKeyValueList(envText(env['OTEL_EXPORTER_OTLP_HEADERS'])),
    ...parseKeyValueList(envText(env['OTEL_EXPORTER_OTLP_TRACES_HEADERS'])),
  };
}

export function resourceAttributesFromEnv(env: Env): Record<string, string> {
  const attrs = parseKeyValueList(envText(env['OTEL_RESOURCE_ATTRIBUTES']));
  const serviceName = envText(env['OTEL_SERVICE_NAME']);
  if (serviceName !== undefined) attrs['service.name'] = serviceName;
  return attrs;
}

function assertSupportedProtocol(env: Env): void {
  const specific = envText(env['OTEL_EXPORTER_OTLP_TRACES_PROTOCOL']);
  const generic = envText(env['OTEL_EXPORTER_OTLP_PROTOCOL']);
  const name =
    specific !== undefined
      ? 'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL'
      : 'OTEL_EXPORTER_OTLP_PROTOCOL';
  const value = specific ?? generic;
  if (value !== undefined && value.toLowerCase() !== OTLP_PROTOCOL) {
    throw new Error(
      `unsupported ${name}: ${value} (only ${OTLP_PROTOCOL} is supported)`,
    );
  }
}

export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  options: StartSpanOptions,
  body: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, options);
  try {
    const result = await body(span);
    span.end();
    return result;
  } catch (e) {
    span.fail(e);
    span.end();
    throw e;
  }
}

export function stage<T>(
  tracer: Tracer,
  name: string,
  parent: Span | undefined,
  attributes: Record<string, SpanValue>,
  body: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(tracer, name, { parent, attributes }, body);
}

class OtelSpan implements Span {
  private ended = false;

  constructor(
    private readonly api: OtelApi,
    readonly raw: ApiSpan,
  ) {}

  setAttribute(name: string, value: SpanValue): void {
    this.raw.setAttribute(name, value);
  }

  setAttributes(values: Record<string, SpanValue>): void {
    this.raw.setAttributes(values);
  }

  fail(error: unknown): void {
    if (this.ended) return;
    const exception = error instanceof Error ? error : new Error(errorMessage(error));
    this.raw.recordException(exception);
    this.raw.setStatus({
      code: this.api.SpanStatusCode.ERROR,
      message: exception.message,
    });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.raw.end();
  }
}

class OtelTracer implements Tracer {
  constructor(
    private readonly api: OtelApi,
    private readonly raw: ApiTracer,
  ) {}

  startSpan(name: string, options?: StartSpanOptions): Span {
    const parent = options?.parent;
    // Unwrap through Span.raw, not instanceof: a parent without an OpenTelemetry handle would silently detach the new span.
    const parentRaw = parent?.raw;
    if (parent && !parentRaw) {
      throw new Error('parent span carries no OpenTelemetry handle');
    }
    const context = parentRaw
      ? this.api.trace.setSpan(this.api.context.active(), parentRaw)
      : undefined;
    return new OtelSpan(
      this.api,
      this.raw.startSpan(name, { attributes: options?.attributes }, context),
    );
  }
}

export interface CreateTracingOptions {
  env?: Env;
  spanExporter?: SpanExporter;
}

export async function createTracing(
  options: CreateTracingOptions = {},
): Promise<Tracing> {
  const env = options.env ?? process.env;
  if (!isTracingEnabled(env)) {
    return {
      enabled: false,
      tracer: NOOP_TRACER,
      flush: async () => {},
      shutdown: async () => {},
    };
  }
  assertSupportedProtocol(env);

  const api = await import('@opentelemetry/api');
  const { TracerProvider, BatchSpanProcessor } = await import(
    '@opentelemetry/sdk-trace'
  );
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { OTLPTraceExporter } = await import(
    '@opentelemetry/exporter-trace-otlp-proto'
  );
  const exporter =
    options.spanExporter ??
    new OTLPTraceExporter({
      url: otlpTracesUrl(env),
      headers: otlpHeaders(env),
    });

  const resource = resourceFromAttributes({
    'service.name': SERVICE_NAME,
    'service.version': VERSION,
  }).merge(resourceFromAttributes(resourceAttributesFromEnv(env)));

  const provider = new TracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor({
        exporter,
        // The default queue (2048) drops spans silently; long batches need thousands to survive.
        maxQueueSize: 8192,
      }),
    ],
  });
  return {
    enabled: true,
    tracer: new OtelTracer(api, provider.getTracer(SERVICE_NAME, VERSION)),
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}
