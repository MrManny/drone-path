export function groupFlightMembers<T extends { flight: { flightId: string; order: number } }>(
  clips: readonly T[],
): Map<string, T[]> {
  const flights = new Map<string, T[]>();
  for (const clip of clips) {
    const { flightId } = clip.flight;
    const members = flights.get(flightId);
    if (members) members.push(clip);
    else flights.set(flightId, [clip]);
  }
  for (const members of flights.values()) members.sort((a, b) => a.flight.order - b.flight.order);
  return flights;
}
