import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Props {
  lat: number;
  lng: number;
  vehicleState: string;
  speedKmh: number;
  zone: string;
}

const APPROVED_ZONE = {
  minLat: 47.3700, maxLat: 47.3800,
  minLng: 8.5300, maxLng: 8.5500,
};

export default function VehicleMap({ lat, lng, vehicleState }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          swisstopo: {
            type: 'raster',
            tiles: [
              'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.swisstopo.ch">swisstopo</a>',
          },
        },
        layers: [
          {
            id: 'swisstopo-layer',
            type: 'raster',
            source: 'swisstopo',
            minzoom: 0,
            maxzoom: 18,
          },
        ],
      },
      center: [lng, lat],
      zoom: 15,
    });

    map.on('load', () => {
      map.addSource('approved-zone', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [APPROVED_ZONE.minLng, APPROVED_ZONE.minLat],
              [APPROVED_ZONE.maxLng, APPROVED_ZONE.minLat],
              [APPROVED_ZONE.maxLng, APPROVED_ZONE.maxLat],
              [APPROVED_ZONE.minLng, APPROVED_ZONE.maxLat],
              [APPROVED_ZONE.minLng, APPROVED_ZONE.minLat],
            ]],
          },
        },
      });
      map.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: 'approved-zone',
        paint: { 'fill-color': '#4caf50', 'fill-opacity': 0.1 },
      });
      map.addLayer({
        id: 'zone-border',
        type: 'line',
        source: 'approved-zone',
        paint: { 'line-color': '#4caf50', 'line-width': 2, 'line-dasharray': [4, 2] },
      });
    });

    const el = document.createElement('div');
    el.id = 'vehicle-marker';
    el.style.cssText = 'width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,0.5);';
    const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);

    mapRef.current = map;
    markerRef.current = marker;

    // Robustness: if the flex/router layout sizes the container a tick after mount,
    // MapLibre may init at 0×0. Force a resize on the next frames + on window resize.
    const raf = requestAnimationFrame(() => map.resize());
    const t = setTimeout(() => map.resize(), 200);
    const onResize = () => map.resize();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!markerRef.current) return;
    markerRef.current.setLngLat([lng, lat]);

    const el = markerRef.current.getElement();
    el.style.backgroundColor = vehicleState === 'SAFE_STOPPED' ? '#f44336' : '#4caf50';

    if (mapRef.current) {
      mapRef.current.easeTo({ center: [lng, lat], duration: 200 });
    }
  }, [lat, lng, vehicleState]);

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
