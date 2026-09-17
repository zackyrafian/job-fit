export type SkillGroup = {
  core: string[];
  other: string[];
};

export type JobMatch = {
  score: number;
  matched: string[];
  missing: string[];
  matchedCore: number;
  coreTotal: number;
};

const ALIAS_GROUPS: string[][] = [
  ["go", "golang"],
  ["nodejs", "node"],
  ["reactjs", "react"],
  ["nextjs", "next"],
  ["vuejs", "vue"],
  ["nuxtjs", "nuxt"],
  ["angularjs", "angular"],
  ["expressjs", "express"],
  ["postgresql", "postgres"],
  ["mongodb", "mongo"],
  ["kubernetes", "k8s"],
  ["typescript", "ts"],
  ["javascript", "js"],
  ["tailwindcss", "tailwind"],
  ["dotnet", "aspnet"],
  ["amazon web services", "aws"],
  ["google cloud platform", "gcp", "google cloud"],
  ["ci cd", "cicd", "continuous integration"],
  ["rest api", "restful", "restful api"],
  ["microservices", "microservice"],
  ["graphql", "gql"],
  ["elasticsearch", "elastic search"],
  ["mysql", "mariadb"],
  ["csharp", "c sharp"],
  ["cplusplus", "cpp", "c plus plus"],
  ["spring boot", "springboot"],
  ["react native", "reactnative"],
  ["machine learning", "ml"],
  ["data warehouse", "datawarehouse"],
];

const BARE_FORMS_TOO_AMBIGUOUS = new Set(["go", "next", "ts", "js", "rest", "c", "r", "ml", "gql"]);

const GO_CONTEXT =
  /(^|[^a-z0-9+#])(?:golang|\(\s*go\s*\)|\bgo\s*(?=developer|dev\b|engineer|programmer|backend|back\s*end|lang\b|language|[,/])|\bgo\s*\/|\/\s*go\b)/;

function preNormalize(text: string): string {
  return text
    .replace(/\.net\b/gi, " dotnet ")
    .replace(/\bc#/gi, " csharp ")
    .replace(/\bc\+\+/gi, " cplusplus ")
    .replace(/\bnode\.?js\b/gi, " nodejs ")
    .replace(/\bnext\.?js\b/gi, " nextjs ")
    .replace(/\breact\.?js\b/gi, " reactjs ")
    .replace(/\bvue\.?js\b/gi, " vuejs ")
    .replace(/\bnuxt\.?js\b/gi, " nuxtjs ")
    .replace(/\bangular\.?js\b/gi, " angularjs ")
    .replace(/\bexpress\.?js\b/gi, " expressjs ")
    .replace(/tailwind\s*css/gi, " tailwindcss ");
}

export function canonicalize(text: string): string {
  return preNormalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function variantsFor(skill: string): string[] {
  const parts = skill
    .split(/[/,()|]+/)
    .map(canonicalize)
    .filter(Boolean);

  const out = new Set<string>();
  for (const part of parts) {
    out.add(part);
    for (const group of ALIAS_GROUPS) {
      if (group.includes(part)) for (const alias of group) out.add(alias);
    }
  }
  return [...out].filter((v) => v.length > 1);
}

function mentions(canonicalText: string, variants: string[]): boolean {
  if (variants.includes("golang") && GO_CONTEXT.test(canonicalText)) return true;

  const usable = variants.filter((v) => !BARE_FORMS_TOO_AMBIGUOUS.has(v));
  if (usable.length === 0) return false;

  const alternation = usable
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");
  return new RegExp(`(^|[^a-z0-9+#])(?:${alternation})([^a-z0-9+#]|$)`, "i").test(canonicalText);
}

export function matchJob(description: string, skills: SkillGroup): JobMatch {
  const text = canonicalize(description);

  const core = [...new Set(skills.core)].filter(Boolean);
  const other = [...new Set(skills.other)].filter(Boolean).filter((s) => !core.includes(s));

  const matched: string[] = [];
  const missing: string[] = [];
  let weightedHit = 0;
  let weightedTotal = 0;
  let matchedCore = 0;

  for (const [list, weight] of [
    [core, 2],
    [other, 1],
  ] as const) {
    for (const skill of list) {
      weightedTotal += weight;
      const hit = mentions(text, variantsFor(skill));
      if (hit) {
        weightedHit += weight;
        matched.push(skill);
        if (weight === 2) matchedCore += 1;
      } else {
        missing.push(skill);
      }
    }
  }

  return {
    score: weightedTotal > 0 ? Math.round((weightedHit / weightedTotal) * 100) : 0,
    matched,
    missing,
    matchedCore,
    coreTotal: core.length,
  };
}
