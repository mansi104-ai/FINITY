import { ImageResponse } from "next/og";

export const alt = "Findec - AI stock briefs and live markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const logo = `data:image/svg+xml,${encodeURIComponent(`
  <svg width="180" height="180" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <rect width="64" height="64" rx="14" fill="#15122b"/>
    <path d="M12 9 L53 9 L44 20 L23 20 Z" fill="#2b8cff"/>
    <path d="M14 9 L25 9 L25 55 L14 55 Z" fill="#2b8cff"/>
    <path d="M25 25 L45 25 L37 36 L25 36 Z" fill="#2b8cff"/>
    <path d="M17 39 L25 39 L25 55 L17 55 Z" fill="#2ed2f0"/>
    <path d="M49 23 H57 M53 19 V27" stroke="#5ef0ff" stroke-width="2.6" stroke-linecap="round"/>
  </svg>
`)}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "72px 96px",
          background: "#0c0c0d",
          color: "#f5f7fa",
          fontFamily: "Arial",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
          <img src={logo} width="180" height="180" alt="Findec logo" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: 0 }}>Findec</div>
            <div style={{ marginTop: 18, fontSize: 30, color: "#aeb6c2" }}>
              AI stock briefs. Live India and global markets.
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
