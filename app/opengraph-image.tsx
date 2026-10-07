import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'TrimScout | Whole Market Vehicle Search & Dealership Bidding';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#090a0f',
          padding: '72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="data:image/png;base64,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"
            width={64}
            height={64}
            style={{ borderRadius: 18 }}
          />
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, color: '#f3f4f6', letterSpacing: '-0.02em' }}>
            <span>Trim</span>
            <span style={{ color: '#D9722A' }}>Scout</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 60,
              fontWeight: 800,
              color: '#f3f4f6',
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              maxWidth: 980,
            }}
          >
            Whole-market vehicle search &amp; dealership bidding
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              color: '#9aa3af',
              lineHeight: 1.5,
              maxWidth: 880,
            }}
          >
            Search by exact option packages, track real market prices, and let dealers compete with transparent out-the-door bids.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 40 }}>
          {['Porsche', 'Ford', 'Chevrolet'].map((brand) => (
            <div
              key={brand}
              style={{
                display: 'flex',
                fontSize: 22,
                fontWeight: 600,
                color: '#D9722A',
                border: '1px solid #232836',
                borderRadius: 999,
                padding: '10px 24px',
              }}
            >
              {brand}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
