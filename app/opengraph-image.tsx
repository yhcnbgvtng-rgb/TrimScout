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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 64,
              height: 64,
              borderRadius: 18,
              background: '#10b981',
            }}
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#090a0f" strokeWidth="2.4">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#090a0f" stroke="none" />
            </svg>
          </div>
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
