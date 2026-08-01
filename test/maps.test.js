import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchContinentCatalog,
  fetchMapCatalog,
  htmlToPlainText,
  mapFromApiPage,
} from "../js/maps.js";

test("turns a Commons HTML description into compact plain text", () => {
  const html =
    '<p>A <a href="/wiki/File:Map.svg">blank map</a>&nbsp;with circles.</p><style>.hidden{}</style>';

  assert.equal(htmlToPlainText(html), "A blank map with circles.");
});

test("maps Commons image metadata to a selector entry", () => {
  const map = mapFromApiPage({
    title: "File:Example_world_map.svg",
    imageinfo: [
      {
        url: "https://upload.wikimedia.org/example.svg",
        thumburl: "https://upload.wikimedia.org/example.png",
        extmetadata: { ImageDescription: { value: "A detailed <b>world map</b>." } },
      },
    ],
  });

  assert.equal(map.name, "Example world map");
  assert.equal(map.description, "A detailed world map.");
  assert.equal(map.categoryMap, true);
  assert.equal(map.scope, "world");
});

test("keeps only verified interactive maps and prioritizes the microstates map", async () => {
  const responses = [
    {
      continue: { gcmcontinue: "next-page" },
      query: {
        pages: [
          {
            title: "File:Zeta.svg",
            imageinfo: [{ url: "https://upload.wikimedia.org/zeta.svg", extmetadata: {} }],
          },
          {
            title: "File:BlankMap-World-with-Circles.svg",
            imageinfo: [{ url: "https://upload.wikimedia.org/circles.svg", extmetadata: {} }],
          },
        ],
      },
    },
    {
      query: {
        pages: [
          {
            title: "File:BlankMap-World-Microstates.svg",
            imageinfo: [{ url: "https://upload.wikimedia.org/preferred.svg", extmetadata: {} }],
          },
        ],
      },
    },
  ];
  let requestCount = 0;
  const fetcher = async () => ({
    ok: true,
    json: async () => responses[requestCount++],
  });

  const maps = await fetchMapCatalog(fetcher);

  assert.equal(requestCount, 2);
  assert.deepEqual(
    maps.map((map) => map.title),
    ["File:BlankMap-World-Microstates.svg", "File:BlankMap-World-with-Circles.svg"],
  );
});

test("builds the curated interactive continent catalog in configured order", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({
      query: {
        pages: [
          "File:BlankMap-Africa.svg",
          "File:Blank map of Europe (without disputed regions).svg",
        ].map((title, index) => ({
          title,
          imageinfo: [
            {
              url: `https://upload.wikimedia.org/continent-${index}.svg`,
              extmetadata: {},
            },
          ],
        })),
      },
    }),
  });

  const maps = await fetchContinentCatalog(fetcher);

  assert.deepEqual(
    maps.map((map) => [map.region, map.scope]),
    [
      ["Europe", "continent"],
      ["Africa", "continent"],
    ],
  );
  assert.equal(maps[0].categoryMap, false);
});
