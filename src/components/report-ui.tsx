import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  CATEGORY_LABEL_ID,
  scoreNote,
  scoreVerdict,
  type AbsorptionRow,
  type ChangeItem,
  type GapGroup,
  type KeywordGroup,
  type PanelSummary,
} from "@/lib/report";
import type { ScoreBreakdown } from "@/lib/score";

export const TONE = {
  pine: "#2e6b4c",
  brass: "#97701a",
  rust: "#ae482c",
  pineDeep: "#1f4d3a",
} as const;

export type Tone = "pine" | "brass" | "rust" | "muted";

const DOT: Record<Tone, string> = {
  pine: "bg-pine-2",
  brass: "bg-brass",
  rust: "bg-rust",
  muted: "bg-ink-3",
};

const TEXT: Record<Tone, string> = {
  pine: "text-pine",
  brass: "text-brass",
  rust: "text-rust",
  muted: "text-ink-3",
};

export function toneForScore(score: number): string {
  if (score >= 70) return TONE.pine;
  if (score >= 40) return TONE.brass;
  return TONE.rust;
}

const ICON_PATHS: Record<string, ReactNode> = {
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9.25" />
      <path d="m8.5 12 2.4 2.4L15.6 9.8" />
    </>
  ),
  "arrow-up-right": (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  "file-text": (
    <>
      <path d="M14 2.75H7A2.25 2.25 0 0 0 4.75 5v14A2.25 2.25 0 0 0 7 21.25h10A2.25 2.25 0 0 0 19.25 19V8z" />
      <path d="M14 2.75V8h5.25" />
      <path d="M8.5 13h7" />
      <path d="M8.5 17h4.5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5c.6 3.6 1.9 4.9 5.5 5.5-3.6.6-4.9 1.9-5.5 5.5-.6-3.6-1.9-4.9-5.5-5.5 3.6-.6 4.9-1.9 5.5-5.5Z" />
      <path d="M18 15.5c.3 1.7.9 2.3 2.6 2.6-1.7.3-2.3.9-2.6 2.6-.3-1.7-.9-2.3-2.6-2.6 1.7-.3 2.3-.9 2.6-2.6Z" />
    </>
  ),
};

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}

export function Kicker({
  children,
  tone = "pine",
  className,
}: {
  children: ReactNode;
  tone?: "pine" | "muted";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "font-mono text-[11px] uppercase tracking-[1.5px]",
        tone === "pine" ? "text-pine" : "text-ink-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Rule({ heavy = false, className }: { heavy?: boolean; className?: string }) {
  return <div className={cn("h-px w-full", heavy ? "bg-rule-2" : "bg-rule", className)} />;
}

export function Tag({ label, tone = "pine" }: { label: string; tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1.2px]",
        TEXT[tone],
      )}
    >
      <span className={cn("size-[6px] shrink-0 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}

export function Bar({ pct, color, height = 5 }: { pct: number; color: string; height?: number }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative w-full overflow-hidden rounded-[3px] bg-rule" style={{ height }}>
      <div
        className="absolute inset-y-0 left-0 rounded-[3px] transition-[width] duration-700 ease-out"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </div>
  );
}

export function SectionHeader({
  kicker,
  title,
  right,
}: {
  kicker: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div className="min-w-0">
        <Kicker>{kicker}</Kicker>
        <h3 className="mt-3 font-serif text-[26px] leading-[1.1] tracking-[-0.6px] md:text-[32px]">
          {title}
        </h3>
      </div>
      {right ? <div className="pb-1">{right}</div> : null}
    </div>
  );
}

export function ScoreRow({ score }: { score: ScoreBreakdown }) {
  return (
    <div className="flex flex-col gap-12 lg:flex-row lg:gap-[72px]">
      <div className="lg:w-[352px] lg:shrink-0">
        <Kicker tone="muted">Skor kecocokan</Kicker>
        <div className="mt-5 flex items-end">
          <span className="font-serif text-[76px] leading-[0.84] tracking-[-4px] tabular-nums md:text-[112px] md:tracking-[-5px]">
            {score.overall}
          </span>
          <span className="mb-[12px] ml-1 font-serif text-[30px] leading-none text-ink-3 md:mb-[16px] md:text-[42px]">
            %
          </span>
        </div>
        <div className="mt-6 w-full max-w-[260px]">
          <Bar pct={score.overall} color={TONE.pine} height={6} />
        </div>
        <p className="mt-6 font-serif text-[22px] tracking-[-0.3px] text-pine md:text-[25px]">
          {scoreVerdict(score.overall)}
        </p>
        <p className="mt-3 max-w-[300px] text-[15px] leading-[23px] text-ink-2">
          {scoreNote(score.counts)}
        </p>
      </div>

      <div className="min-w-0 flex-1">
        <Kicker tone="muted">Dimensi penilaian</Kicker>
        <div className="mt-6 flex flex-col gap-6">
          {score.categories.map((c) => (
            <div key={c.category} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2">
              <span className="text-[15px] text-ink-2">{CATEGORY_LABEL_ID[c.category] ?? c.label}</span>
              <span className="font-mono text-[12px] tabular-nums text-ink-3">{c.score}%</span>
              <div className="col-span-2">
                <Bar pct={c.score} color={toneForScore(c.score)} height={5} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SkillRow({
  name,
  tag,
  tone,
  italic = false,
  children,
}: {
  name: string;
  tag: string;
  tone: Tone;
  italic?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-rule py-[22px] md:flex-row md:gap-[44px]">
      <div className="md:w-[250px] md:shrink-0">
        <div className="font-serif text-[22px] leading-[1.15] tracking-[-0.4px] md:text-[27px]">
          {name}
        </div>
        <div className="mt-2.5">
          <Tag label={tag} tone={tone} />
        </div>
      </div>
      <div className="min-w-0 md:flex-1 md:border-l-2 md:border-rule-2 md:pl-6">
        <div className={cn("text-[15px] leading-[23px] text-ink-2", italic && "italic")}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 border-t border-rule py-[22px] text-[15px] leading-[23px] text-ink-3">
      <Icon name="check-circle" className="size-4 shrink-0 text-pine-2" />
      {text}
    </div>
  );
}

const KEYWORD_META: Record<string, { label: string; tone: Tone }> = {
  "already present": { label: "SUDAH ADA", tone: "pine" },
  "missing but supported": { label: "HILANG TAPI DIDUKUNG", tone: "brass" },
  "missing and unsupported": { label: "HILANG & TIDAK DIDUKUNG", tone: "rust" },
};

export function KeywordGroups({ groups }: { groups: KeywordGroup[] }) {
  return (
    <div className="border-t border-rule">
      {groups.map((g, i) => {
        const meta =
          KEYWORD_META[g.label.toLowerCase()] ??
          ({ label: g.label.toUpperCase(), tone: "muted" } as { label: string; tone: Tone });
        return (
          <div
            key={i}
            className="grid gap-2.5 border-b border-rule py-[22px] md:grid-cols-[280px_1fr] md:gap-[44px]"
          >
            <Tag label={meta.label} tone={meta.tone} />
            <p className="text-[15px] leading-[23px] text-ink-2">{g.items.join(" · ")}</p>
          </div>
        );
      })}
    </div>
  );
}

const ABSORB_META: Record<string, { label: string; tone: Tone }> = {
  SAFE_TO_ABSORB: { label: "AMAN DISERAP", tone: "pine" },
  RELATED: { label: "TERKAIT", tone: "brass" },
  DO_NOT_CLAIM: { label: "JANGAN DIKLAIM", tone: "rust" },
};

export function AbsorptionList({ rows }: { rows: AbsorptionRow[] }) {
  return (
    <div className="border-t border-rule">
      {rows.map((r, i) => {
        const meta =
          ABSORB_META[r.status] ?? ({ label: r.status, tone: "muted" } as { label: string; tone: Tone });
        return (
          <div
            key={i}
            className="grid gap-3 border-b border-rule py-[20px] md:grid-cols-[240px_180px_1fr] md:gap-[44px]"
          >
            <div className="font-serif text-[19px] leading-[1.2] tracking-[-0.2px]">{r.keyword}</div>
            <div className="md:pt-1">
              <Tag label={meta.label} tone={meta.tone} />
            </div>
            <p className="text-[15px] leading-[23px] text-ink-2">{r.recommendation}</p>
          </div>
        );
      })}
    </div>
  );
}

function ChangeField({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="grid gap-1.5 md:grid-cols-[130px_1fr] md:gap-6">
      <dt className="pt-[3px] font-mono text-[10px] uppercase tracking-[1.2px] text-ink-3">{label}</dt>
      <dd className={cn("text-[15px] leading-[23px]", highlight ? "text-pine" : "text-ink-2")}>
        {value}
      </dd>
    </div>
  );
}

export function ChangeBlock({ item }: { item: ChangeItem }) {
  return (
    <div className="flex gap-5 border-t border-rule py-[26px] md:gap-8">
      <div className="pt-1 font-mono text-[12px] tabular-nums text-ink-3">
        {item.num.padStart(2, "0")}
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="font-serif text-[21px] leading-[1.2] tracking-[-0.3px] md:text-[24px]">
          {item.title}
        </h4>
        <dl className="mt-5 flex flex-col gap-4">
          <ChangeField label="Sekarang" value={item.current} />
          <ChangeField label="Disarankan" value={item.recommended} highlight />
          <ChangeField label="Alasan" value={item.reason} />
        </dl>
      </div>
    </div>
  );
}

const GAP_TONE: Record<string, Tone> = {
  "COCOK KUAT": "pine",
  "COCOK SEBAGIAN": "brass",
  KESENJANGAN: "rust",
};

export function GapLists({ gaps }: { gaps: GapGroup[] }) {
  return (
    <div className="grid gap-10 border-t border-rule pt-[26px] md:grid-cols-3 md:gap-[44px]">
      {gaps.map((g) => {
        const tone = GAP_TONE[g.label] ?? "muted";
        return (
          <div key={g.label}>
            <Tag label={g.label} tone={tone} />
            <ul className="mt-4 flex flex-col gap-2.5">
              {g.items.map((item, i) => (
                <li key={i} className="flex gap-2.5 text-[15px] leading-[23px] text-ink-2">
                  <span className={cn("mt-[9px] size-[5px] shrink-0 rounded-full", DOT[tone])} />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function MonoBox({
  kicker,
  items,
  tone,
}: {
  kicker: string;
  items: string[];
  tone: "pine" | "rust";
}) {
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        "rounded-[6px] border p-[22px] md:p-[26px]",
        tone === "pine" ? "border-pine-2/30 bg-pine-2/[0.06]" : "border-rust/30 bg-rust/[0.05]",
      )}
    >
      <Tag label={kicker} tone={tone} />
      <div className="mt-4 flex flex-wrap gap-x-2.5 gap-y-2">
        {items.map((item, i) => (
          <span
            key={i}
            className={cn(
              "rounded-[3px] border px-2 py-1 font-mono text-[11px] tracking-[0.2px]",
              tone === "pine"
                ? "border-pine-2/25 text-pine"
                : "border-rust/25 text-rust line-through decoration-rust/40",
            )}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SummaryPanel({
  kicker,
  data,
  icon,
}: {
  kicker: string;
  data: PanelSummary;
  icon: string;
}) {
  return (
    <div className="flex h-full flex-col rounded-[6px] border border-rule bg-sheet p-[22px] md:p-[26px]">
      <Kicker tone="muted">{kicker}</Kicker>
      <div className="mt-4 font-serif text-[24px] leading-[1.15] tracking-[-0.4px] md:text-[27px]">
        {data.title}
      </div>
      <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[1px] text-ink-3">
        {data.meta}
      </div>
      <Rule className="my-4" />
      <p className="text-[15px] leading-[23px] text-ink-2">{data.summary}</p>
      <div className="mt-auto flex items-center gap-2 pt-5 font-mono text-[10.5px] uppercase tracking-[1px] text-ink-3">
        <Icon name={icon} className="size-3.5 shrink-0" />
        <span className="truncate">{data.file}</span>
      </div>
    </div>
  );
}

