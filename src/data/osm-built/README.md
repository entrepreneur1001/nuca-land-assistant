Built points per district for the sync's "near already-built" measure, fetched offline from OpenStreetMap when
Overpass will not answer the GitHub runner. One file per source sector id: `<sector id>.json` =
`{"centre": [lat, lng], "radiusM": 5000, "fetchedAt": "<ISO time>", "points": [[lat, lng], …]}` (building and
developed-landuse way centres within the radius). The sync uses the file instead of Overpass for that district.
