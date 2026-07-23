// Localized fixed strings for the AI Act compliance PDF (ADR-0016 category 3:
// one localized template, reader's language). Kept LOCAL to this endpoint on
// purpose — when #225 builds the shared server-document i18n helper, this is
// extracted and adopted. Variable data (org, names, numbers, dates) is passed
// in and stays language-neutral.

export type Lang = 'da' | 'en';
export type LevelKey = 'basic' | 'intermediate' | 'advanced' | 'na';
export type DeptStatus = 'ok' | 'warn' | 'bad';

export interface StatusParts {
  lead: string;
  pct: string; // rendered bold
  mid: string;
  action: string; // rendered bold; oxblood when deficiency
  deficiency: boolean;
  tail: string;
}

export interface ReportStrings {
  docType: string;
  conf: string;
  title: string;
  reg: string;
  metaLabels: { org: string; period: string; preparedBy: string; issued: string };
  periodValue: (date: string) => string;
  roleAdmin: string;
  rolePlatform: string;
  declare: string;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  kf: { staff: string; trained: string; participation: string; notTrained: string; refresher: string };
  d2: [string, string, string, string, string, string];
  note2: (target: number) => string;
  d3: [string, string];
  d4: [string, string, string];
  levelName: Record<LevelKey, string>;
  statusName: Record<DeptStatus, string>;
  status: (pctStr: string, target: number, belowN: number, deficiency: boolean) => StatusParts;
  emptyStatus: string;
  cert: string;
  sig: [string, string, string];
  footL: (org: string) => string;
  footR: (page: number, pages: number, ref: string) => string;
  unassigned: string;
  emptyDepts: string;
  emptyCourses: string;
  locale: string;
  dateFmt: Intl.DateTimeFormatOptions;
}

const DATE_FMT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };

export const STRINGS: Record<Lang, ReportStrings> = {
  en: {
    docType: 'Compliance Report',
    conf: 'Confidential',
    title: 'AI Literacy & Training Report',
    reg: 'Supporting documentation for obligations under Article 4, Regulation (EU) 2024/1689 (the AI Act)',
    metaLabels: { org: 'Organisation', period: 'Reporting period', preparedBy: 'Prepared by', issued: 'Date of issue' },
    periodValue: (d) => `Through ${d}`,
    roleAdmin: 'Org admin',
    rolePlatform: 'Platform admin',
    declare:
      'This report sets out the current status of staff artificial-intelligence literacy training at the organisation named above. It is prepared as supporting documentation for that organisation’s obligation, under Article 4 of Regulation (EU) 2024/1689, to ensure a sufficient level of AI literacy among staff who operate or use AI systems. The figures reflect training and assessment records held by the AI Uddannelse platform as at the reporting date.',
    s1: 'Summary of findings',
    s2: 'Coverage by department',
    s3: 'Course completion',
    s4: 'Assessed literacy',
    kf: { staff: 'Staff in scope', trained: 'Staff trained', participation: 'Participation', notTrained: 'Not yet trained', refresher: 'Refresher due' },
    d2: ['Department', 'Staff', 'Trained', 'Participation', 'Assessed level', 'Status'],
    note2: (t) => `“Trained” = staff who have completed at least one AI-literacy course. Target: min. ${t}% per department.`,
    d3: ['Course', 'Completed'],
    d4: ['Level', 'Staff', 'Share'],
    levelName: { basic: 'Basic', intermediate: 'Intermediate', advanced: 'Advanced', na: 'Not assessed' },
    statusName: { ok: 'On track', warn: 'Below target', bad: 'Priority' },
    status: (pctStr, target, belowN, deficiency) =>
      deficiency
        ? {
            lead: 'Overall, ',
            pct: pctStr,
            mid: ` of staff have completed at least one AI-literacy course, below the organisation’s ${target}% target. Assessed status: `,
            action: 'Action required',
            deficiency: true,
            tail:
              belowN === 1
                ? '. One department falls materially below target and is identified in §2.'
                : `. ${belowN} departments fall materially below target and are identified in §2.`,
          }
        : {
            lead: 'Overall, ',
            pct: pctStr,
            mid: ` of staff have completed at least one AI-literacy course, meeting the organisation’s ${target}% target. Assessed status: `,
            action: 'On track',
            deficiency: false,
            tail: '. Department-level detail is set out in §2.',
          },
    emptyStatus: 'No active members are in scope for this organisation as at the reporting date, so participation cannot be assessed.',
    cert: 'I certify that, to the best of my knowledge, the figures set out above reflect the organisation’s training and assessment records as at the reporting date.',
    sig: ['Prepared by — signature', 'Reviewed by — signature', 'Date'],
    footL: (org) => `Confidential — ${org}`,
    footR: (p, n, ref) => `Ref. ${ref} — Page ${p} of ${n}`,
    unassigned: 'Unassigned',
    emptyDepts: 'No active members in scope.',
    emptyCourses: 'No courses enabled for this organisation.',
    locale: 'en-US',
    dateFmt: DATE_FMT,
  },
  da: {
    docType: 'Overholdelsesrapport',
    conf: 'Fortroligt',
    title: 'Rapport om AI-færdigheder og uddannelse',
    reg: 'Dokumentation til støtte for forpligtelser efter artikel 4, forordning (EU) 2024/1689 (AI-forordningen)',
    metaLabels: { org: 'Organisation', period: 'Rapporteringsperiode', preparedBy: 'Udarbejdet af', issued: 'Udstedelsesdato' },
    periodValue: (d) => `Til og med ${d}`,
    roleAdmin: 'org.admin',
    rolePlatform: 'platformadmin',
    declare:
      'Denne rapport beskriver den aktuelle status for medarbejdernes uddannelse i AI-færdigheder i ovennævnte organisation. Den er udarbejdet som dokumentation til støtte for organisationens forpligtelse efter artikel 4 i forordning (EU) 2024/1689 til at sikre et tilstrækkeligt niveau af AI-færdigheder blandt medarbejdere, der anvender eller betjener AI-systemer. Tallene afspejler uddannelses- og vurderingsdata registreret på AI Uddannelse-platformen pr. rapporteringsdatoen.',
    s1: 'Sammenfatning af resultater',
    s2: 'Dækning pr. afdeling',
    s3: 'Kursusgennemførelse',
    s4: 'Vurderede færdigheder',
    kf: { staff: 'Medarbejdere', trained: 'Uddannede', participation: 'Deltagelse', notTrained: 'Ikke uddannet', refresher: 'Genopfriskning' },
    d2: ['Afdeling', 'Medarb.', 'Uddannet', 'Deltagelse', 'Vurderet niveau', 'Status'],
    note2: (t) => `”Uddannet” = medarbejdere, der har gennemført mindst ét kursus i AI-færdigheder. Mål: min. ${t}% pr. afdeling.`,
    d3: ['Kursus', 'Gennemført'],
    d4: ['Niveau', 'Medarb.', 'Andel'],
    levelName: { basic: 'Begynder', intermediate: 'Øvet', advanced: 'Avanceret', na: 'Ikke vurderet' },
    statusName: { ok: 'På sporet', warn: 'Under mål', bad: 'Prioritet' },
    status: (pctStr, target, belowN, deficiency) =>
      deficiency
        ? {
            lead: 'Samlet set har ',
            pct: pctStr,
            mid: ` af medarbejderne gennemført mindst ét kursus i AI-færdigheder, hvilket er under organisationens mål på ${target}%. Vurderet status: `,
            action: 'Handling påkrævet',
            deficiency: true,
            tail:
              belowN === 1
                ? '. Én afdeling ligger væsentligt under målet og er angivet i §2.'
                : `. ${belowN} afdelinger ligger væsentligt under målet og er angivet i §2.`,
          }
        : {
            lead: 'Samlet set har ',
            pct: pctStr,
            mid: ` af medarbejderne gennemført mindst ét kursus i AI-færdigheder, hvilket opfylder organisationens mål på ${target}%. Vurderet status: `,
            action: 'På sporet',
            deficiency: false,
            tail: '. Detaljer pr. afdeling fremgår af §2.',
          },
    emptyStatus: 'Ingen aktive medarbejdere er omfattet for organisationen pr. rapporteringsdatoen, så deltagelse kan ikke vurderes.',
    cert: 'Jeg bekræfter, at ovenstående tal efter min bedste overbevisning afspejler organisationens uddannelses- og vurderingsdata pr. rapporteringsdatoen.',
    sig: ['Udarbejdet af — underskrift', 'Kontrolleret af — underskrift', 'Dato'],
    footL: (org) => `Fortroligt — ${org}`,
    footR: (p, n, ref) => `Ref. ${ref} — Side ${p} af ${n}`,
    unassigned: 'Ikke tildelt',
    emptyDepts: 'Ingen aktive medarbejdere i perioden.',
    emptyCourses: 'Ingen kurser aktiveret for organisationen.',
    locale: 'da-DK',
    dateFmt: DATE_FMT,
  },
};

export function resolveLang(input: unknown): Lang {
  return input === 'da' ? 'da' : 'en';
}
