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
            <span style={{ color: '#10b981' }}>Scout</span>
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
                color: '#10b981',
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
