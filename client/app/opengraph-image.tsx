import { ImageResponse } from "next/og";

export const alt = "Findec - AI stock briefs and live markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
          <div
            style={{
              width: 180,
              height: 180,
              display: "flex",
              position: "relative",
              background: "#15122b",
              borderRadius: 40,
            }}
          >
            <div style={{ position: "absolute", top: 26, left: 38, width: 32, height: 128, background: "#2b8cff" }} />
            <div style={{ position: "absolute", top: 26, left: 34, width: 116, height: 32, background: "#2b8cff", transform: "skewX(-35deg)" }} />
            <div style={{ position: "absolute", top: 72, left: 60, width: 70, height: 30, background: "#2b8cff", transform: "skewX(-35deg)" }} />
            <div style={{ position: "absolute", top: 108, left: 47, width: 24, height: 46, background: "#2ed2f0" }} />
          </div>
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
