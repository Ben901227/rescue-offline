import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrackFile, toGpx } from '../js/lib/gpx.js';

const gpx = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="23.94" lon="121.31"><ele>2900</ele><name>牡丹岩 &amp; IPP</name></wpt>
  <trk><name>D2 搜索</name><trkseg>
    <trkpt lat="23.9401" lon="121.3101"><ele>2800.5</ele></trkpt>
    <trkpt lat="23.9402" lon="121.3102"/>
    <trkpt lat="23.9403" lon="121.3103"><ele>2802</ele></trkpt>
  </trkseg></trk>
  <rte><name>計畫路線</name><rtept lat="23.95" lon="121.32"/><rtept lat="23.96" lon="121.33"/></rte>
</gpx>`;

test('GPX：航跡、路線、航點', () => {
  const r = parseTrackFile(gpx);
  assert.equal(r.tracks.length, 2);
  assert.equal(r.tracks[0].name, 'D2 搜索');
  assert.deepEqual(r.tracks[0].points, [
    [23.9401, 121.3101, 2800.5],
    [23.9402, 121.3102, null],
    [23.9403, 121.3103, 2802],
  ]);
  assert.equal(r.tracks[1].name, '計畫路線');
  assert.deepEqual(r.waypoints, [{ name: '牡丹岩 & IPP', lat: 23.94, lng: 121.31, ele: 2900 }]);
});

test('KML：LineString 與 Point', () => {
  const kml = `<kml><Document>
    <Placemark><name>路線</name><LineString><coordinates>121.31,23.94,2900 121.32,23.95,2950</coordinates></LineString></Placemark>
    <Placemark><name><![CDATA[發現點]]></name><Point><coordinates>121.313395,23.940475,0</coordinates></Point></Placemark>
  </Document></kml>`;
  const r = parseTrackFile(kml);
  assert.deepEqual(r.tracks[0], { name: '路線', points: [[23.94, 121.31, 2900], [23.95, 121.32, 2950]] });
  assert.deepEqual(r.waypoints[0], { name: '發現點', lat: 23.940475, lng: 121.313395, ele: 0 });
});

test('toGpx 匯出後可再解析', () => {
  const out = toGpx({ name: 'x', waypoints: [{ name: 'A<B', lat: 1, lng: 2, ele: 3 }], tracks: [{ name: 't', points: [[1, 2, null], [3, 4, 5]] }] });
  const r = parseTrackFile(out);
  assert.equal(r.waypoints[0].name, 'A<B');
  assert.deepEqual(r.tracks[0].points, [[1, 2, null], [3, 4, 5]]);
});

test('非 GPX/KML 會丟錯', () => {
  assert.throws(() => parseTrackFile('{"a":1}'));
});
