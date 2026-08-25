import React, { useMemo } from "react";
import { formatXlm } from "../utils/format";

interface Props {
  history: bigint[];
}

const RevenueSparklineComponent: React.FC<Props> = ({ history }) => {
  const maxVal = useMemo(() => {
    return history.reduce((a, b) => (a > b ? a : b), 0n);
  }, [history]);

  const points = useMemo(() => {
    if (history.length === 0) return [];
    const w = 140;
    const h = 40;
    const margin = 4;
    const usableHeight = h - margin * 2; // 32
    const xSpacing = history.length > 1 ? w / (history.length - 1) : w;
    const maxBig = maxVal > 0n ? maxVal : 1n;

    return history.map((val, idx) => {
      const x = idx * xSpacing;
      const y = h - margin - Number((val * BigInt(usableHeight)) / maxBig);
      return { x, y, value: val, index: idx };
    });
  }, [history, maxVal]);

  const polylinePoints = useMemo(() => {
    return points.map((p) => `${p.x},${p.y}`).join(" ");
  }, [points]);

  if (history.length === 0) {
    return <p className="text-xs text-muted">No data</p>;
  }

  return (
    <div className="revenue-sparkline-container" style={{ width: "100%" }}>
      <style>{`
        .sparkline-point {
          fill: var(--color-primary);
          stroke: var(--color-bg-primary);
          stroke-width: 1.5;
          cursor: pointer;
          transition: r 0.2s ease, fill 0.2s ease;
        }
        .sparkline-point:hover,
        .sparkline-point:focus {
          r: 5;
          fill: var(--color-primary);
          outline: none;
        }
      `}</style>
      <svg
        role="img"
        aria-label="7-Day Revenue History Sparkline"
        aria-describedby="revenue-data-table"
        viewBox="0 0 140 40"
        width="100%"
        height="40px"
        style={{ overflow: "visible" }}
      >
        <polyline
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2"
          points={polylinePoints}
        />
        {points.map((p) => (
          <circle key={p.index} cx={p.x} cy={p.y} r="3" className="sparkline-point" tabIndex={0}>
            <title>{formatXlm(p.value)}</title>
          </circle>
        ))}
      </svg>

      {/* Visually hidden table for accessibility */}
      <table id="revenue-data-table" className="sr-only">
        <caption>7-Day Revenue History</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {history.map((dayRev, idx) => (
            <tr key={idx}>
              <td>Day {idx + 1}</td>
              <td>{formatXlm(dayRev)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const RevenueSparkline = React.memo(RevenueSparklineComponent);
export default RevenueSparkline;
