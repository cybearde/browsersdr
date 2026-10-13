/** Synthetic UI scenarios built from the pinned v2 wire examples; no publication approval. */
import portable from "./fixtures/atlas/browsersdr-public-station-search-v2.json" with { type: "json" };
import {
  type PublicStationDetail,
  parsePublicDetail,
  parsePublicPage,
  parsePublicTransmissions,
} from "../radio/publicStations";
const id = "00000000-0000-4000-8000-000000000001";
const detail = parsePublicDetail(portable.responses[0], id);
const references = structuredClone(
  parsePublicTransmissions(portable.responses[2], id),
);
references.items[0]!.bandwidth_hz = 150000;
const page = parsePublicPage(portable.responses[1]);
const second = {
  ...structuredClone(page.items[0]!),
  station: {
    ...structuredClone(detail.station),
    id: "00000000-0000-4000-8000-000000000002",
    name: "ENERGY München (illustrative)",
  },
};
export const publicStationFixture = {
  queries: [
    {
      response: {
        ...page,
        items: [...page.items, second],
        next_cursor: "synthetic_next",
      },
    },
  ],
  details: { [id]: detail } as Record<string, PublicStationDetail>,
  references,
  selected: { ...detail.station, transmissions: references.items },
};

export function publicReferencesFor(stationId: string) {
  return {
    ...structuredClone(references),
    station_id: stationId,
    items:
      stationId === id
        ? structuredClone(references.items)
        : [
            {
              ...structuredClone(references.items[0]!),
              id: "00000000-0000-4000-8000-000000000021",
              frequency_hz: 93300000,
            },
            {
              ...structuredClone(references.items[1]!),
              id: "00000000-0000-4000-8000-000000000022",
            },
          ],
  };
}
