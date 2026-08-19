import { useState } from 'react';

import type { PlanStep, PlanStepKind } from '@lib/gamedata/plan.js';

/**
 * The plan as a four-lane roadmap: one lane per attribute, steps in order.
 *
 * The point is sequence, not magnitude — which attribute to push at each stage,
 * and where a cap forces a detour — so each step is a labelled mark in its lane
 * rather than a bar whose length means something.
 *
 * Colours are slots 1–4 of the validated categorical palette (dark steps),
 * checked against this surface: worst adjacent CVD ΔE 8.4, normal-vision 19.8,
 * all above 3:1 contrast. Every mark is directly labelled, which is required at
 * four series and also carries identity without relying on colour.
 */

const LANES: { kind: PlanStepKind | 'progression'; label: string; color: string }[] = [
  { kind: 'progression', label: 'Rarity & stars', color: '#3987e5' },
  { kind: 'rank', label: 'Rank', color: '#d95926' },
  { kind: 'level', label: 'Level', color: '#199e70' },
  { kind: 'ability', label: 'Abilities', color: '#c98500' },
];

const laneOf = (step: PlanStep): number =>
  step.kind === 'promotion' || step.kind === 'ascension'
    ? 0
    : step.kind === 'rank'
      ? 1
      : step.kind === 'level'
        ? 2
        : 3;

/** Short text inside a mark: the destination, not the whole sentence. */
function markLabel(step: PlanStep): string {
  switch (step.kind) {
    case 'ascension':
      return step.label.replace(/^Ascend to /, '');
    case 'promotion':
      return `★${step.to}`;
    case 'rank':
      return step.label.replace(/^Rank up to /, '');
    case 'level':
      return `Lv ${step.to}`;
    default:
      return `${step.ability === 'active' ? 'Active' : 'Passive'} ${step.to}`;
  }
}

export function PlanRoadmap({ steps }: { steps: PlanStep[] }) {
  const [hover, setHover] = useState<PlanStep>();

  if (steps.length === 0) {
    return <p className="muted small">Nothing to do — the target is already met.</p>;
  }

  const laneH = 46;
  const gutter = 118;
  const colW = 132;
  const width = gutter + steps.length * colW + 16;
  const height = LANES.length * laneH + 8;
  // A lane with no steps still shows, so "nothing needed here" is visible, but
  // its label recedes rather than reading as a missing row.
  const used = new Set(steps.map(laneOf));

  return (
    <div className="roadmap">
      <div className="roadmap-legend">
        {LANES.map((lane) => (
          <span className="legend-item" key={lane.label}>
            <span className="swatch" style={{ background: lane.color }} />
            {lane.label}
          </span>
        ))}
      </div>

      <div className="roadmap-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
             aria-label="Evolution plan roadmap, ordered by step">
          {LANES.map((lane, i) => (
            <g key={lane.label}>
              <text
                x={0}
                y={i * laneH + 28}
                className={`roadmap-lane-label${used.has(i) ? '' : ' idle'}`}
              >
                {lane.label}
                {!used.has(i) && <tspan className="roadmap-idle-note"> · no change</tspan>}
              </text>
              <line
                x1={gutter - 10} y1={i * laneH + 23} x2={width - 8} y2={i * laneH + 23}
                className="roadmap-rule"
              />
            </g>
          ))}

          {steps.map((step, index) => {
            const lane = laneOf(step);
            const x = gutter + index * colW;
            const y = lane * laneH + 6;
            const active = hover?.order === step.order;
            return (
              <g
                key={step.order}
                onMouseEnter={() => setHover(step)}
                onMouseLeave={() => setHover(undefined)}
                style={{ cursor: 'default' }}
              >
                {/* 2px surface gap keeps adjacent marks from merging */}
                {/* A finished step keeps its place but drops to an outline, so
                    the route still reads left to right while what is left to do
                    stays the thing that carries colour. */}
                <rect
                  x={x} y={y} width={colW - 12} height={34} rx={4}
                  fill={step.done ? 'transparent' : LANES[lane]!.color}
                  opacity={active ? 1 : 0.9}
                  stroke={
                    active ? '#e6edf3' : step.done ? LANES[lane]!.color : 'transparent'
                  }
                  strokeWidth={2}
                  strokeDasharray={step.done ? '4 3' : undefined}
                />
                <text
                  x={x + 10}
                  y={y + 22}
                  className={`roadmap-mark-label${step.done ? ' done' : ''}`}
                >
                  {markLabel(step)}
                </text>
                <text
                  x={x + colW - 18}
                  y={y + 22}
                  className={`roadmap-order${step.done ? ' done' : ''}`}
                  textAnchor="end"
                >
                  {step.done ? '✓' : step.order}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="roadmap-tip small">
        {hover ? (
          <>
            <strong>
              {hover.order}. {hover.label}
            </strong>
            {hover.reason && <span className="muted"> — {hover.reason}</span>}
          </>
        ) : (
          <span className="muted">Hover a step for the reason it is in the plan.</span>
        )}
      </div>
    </div>
  );
}
