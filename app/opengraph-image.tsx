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
            <span style={{ color: '#5DB391' }}>Scout</span>
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
                color: '#5DB391',
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
