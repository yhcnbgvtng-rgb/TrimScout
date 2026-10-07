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
            <span style={{ color: '#E1DEDE' }}>Scout</span>
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
                color: '#E1DEDE',
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
