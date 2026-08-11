import { useMemo, useState } from "react";
import "./SeatMapPanel.css";

function parseSeat(seat) {
  const m = /^(\d+)([A-Z])$/.exec(seat);
  return m ? { row: Number(m[1]), col: m[2] } : { row: 0, col: seat };
}

export default function SeatMapPanel({ flightNumber, seats }) {
  const [selected, setSelected] = useState(null);

  const byCabin = useMemo(() => {
    const groups = new Map();
    for (const s of seats) {
      const cabin = s.cabin || "economy";
      if (!groups.has(cabin)) groups.set(cabin, []);
      groups.get(cabin).push(s);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => {
        const pa = parseSeat(a.seat);
        const pb = parseSeat(b.seat);
        return pa.row - pb.row || String(pa.col).localeCompare(String(pb.col));
      });
    }
    return groups;
  }, [seats]);

  const selectedSeat = selected ? seats.find((s) => s.seat === selected) : null;

  return (
    <div className="smp-card">
      <div className="smp-nose" />
      {[...byCabin.entries()].map(([cabin, list]) => (
        <div className="smp-band" key={cabin}>
          <div className="smp-cabin-label">{cabin}</div>
          <div className="smp-row">
            {list.map((s) => {
              const isSelected = s.seat === selected;
              return (
                <button
                  key={s.seat}
                  type="button"
                  data-testid="seat-cell"
                  className={`smp-seat smp-seat--${cabin}${isSelected ? " smp-seat--selected" : ""}`}
                  disabled={!s.available}
                  title={s.seat}
                  onClick={() => setSelected(s.seat)}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="smp-legend">
        <span><span className="smp-sw" style={{ background: "#1d4ed8" }} />Selected</span>
        <span><span className="smp-sw" style={{ background: "#e0e3ee", opacity: 0.6 }} />Occupied</span>
      </div>
      <div className="smp-summary">
        {selectedSeat
          ? <div className="smp-summary-info">Seat <strong>{selectedSeat.seat}</strong> — {selectedSeat.cabin}, flight {flightNumber}</div>
          : <div className="smp-summary-info">Pick a seat above to see the details here.</div>}
      </div>
    </div>
  );
}
