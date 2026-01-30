/**
 * Title Parser Utility
 *
 * Parses LinkedIn titles into structured seniority and department classifications.
 * Used for enrichment during person snapshot upserts and for query filtering.
 */

/**
 * Seniority level definitions with pattern matching
 * Order matters: higher seniority levels are checked first
 */
const SENIORITY_LEVELS = [
  {
    level: 'c-suite',
    patterns: [
      /\b(C[A-Z]O|Chief\s+\w+\s+Officer|CEO|CFO|CTO|COO|CMO|CIO|CISO|CRO|CPO|CDO)\b/i,
      /\bChief\b/i,
    ],
  },
  {
    level: 'founder',
    patterns: [
      /\b(Founder|Co-?Founder|Co-?Owner|Owner|Partner|Managing\s+Partner)\b/i,
    ],
  },
  {
    level: 'vp',
    patterns: [
      /\b(VP|Vice\s+President|SVP|EVP|AVP|Senior\s+Vice\s+President|Executive\s+Vice\s+President)\b/i,
    ],
  },
  {
    level: 'director',
    patterns: [
      /\b(Director|Sr\.?\s+Director|Senior\s+Director|Managing\s+Director|Executive\s+Director)\b/i,
    ],
  },
  {
    level: 'head',
    patterns: [
      /\b(Head\s+of)\b/i,
    ],
  },
  {
    level: 'manager',
    patterns: [
      /\b(Manager|Sr\.?\s+Manager|Senior\s+Manager|General\s+Manager|Program\s+Manager|Product\s+Manager|Project\s+Manager)\b/i,
    ],
  },
  {
    level: 'lead',
    patterns: [
      /\b(Lead|Team\s+Lead|Tech\s+Lead|Principal)\b/i,
    ],
  },
  {
    level: 'senior',
    patterns: [
      /\b(Senior|Sr\.?)\b/i,
    ],
  },
  {
    level: 'mid',
    patterns: [
      /\b(Mid-?level|Staff)\b/i,
    ],
  },
  {
    level: 'junior',
    patterns: [
      /\b(Junior|Jr\.?|Associate|Entry[\s-]?Level)\b/i,
    ],
  },
  {
    level: 'intern',
    patterns: [
      /\b(Intern|Internship|Trainee|Apprentice|Co-?op)\b/i,
    ],
  },
];

/**
 * Department/function definitions with pattern matching
 */
const DEPARTMENTS = [
  {
    department: 'engineering',
    patterns: [
      /\b(Engineer|Engineering|Software|Developer|Development|SWE|SDE|DevOps|Backend|Frontend|Full[\s-]?Stack|Platform|Infrastructure|Architect|Technical)\b/i,
    ],
  },
  {
    department: 'data',
    patterns: [
      /\b(Data|Analytics|Data\s+Science|Machine\s+Learning|ML|AI|Artificial\s+Intelligence|BI|Business\s+Intelligence)\b/i,
    ],
  },
  {
    department: 'product',
    patterns: [
      /\b(Product|Product\s+Management|Product\s+Manager|PM)\b/i,
    ],
  },
  {
    department: 'design',
    patterns: [
      /\b(Design|UX|UI|User\s+Experience|User\s+Interface|Creative|Graphic|Visual)\b/i,
    ],
  },
  {
    department: 'marketing',
    patterns: [
      /\b(Marketing|Growth|Brand|Content|Digital\s+Marketing|SEO|SEM|Demand\s+Gen|Communications|PR|Public\s+Relations)\b/i,
    ],
  },
  {
    department: 'sales',
    patterns: [
      /\b(Sales|Account\s+Executive|AE|BDR|SDR|Business\s+Development|Revenue|Account\s+Manager|Inside\s+Sales)\b/i,
    ],
  },
  {
    department: 'customer_success',
    patterns: [
      /\b(Customer\s+Success|CS|Customer\s+Support|Support|Client\s+Services|Customer\s+Experience|CX)\b/i,
    ],
  },
  {
    department: 'finance',
    patterns: [
      /\b(Finance|Accounting|Financial|Controller|Treasury|FP&A|Audit)\b/i,
    ],
  },
  {
    department: 'hr',
    patterns: [
      /\b(HR|Human\s+Resources|People\s+Operations|People\s+Ops|Talent|Recruiting|Recruiter|Recruitment)\b/i,
    ],
  },
  {
    department: 'legal',
    patterns: [
      /\b(Legal|Counsel|Attorney|Lawyer|Compliance|Regulatory)\b/i,
    ],
  },
  {
    department: 'operations',
    patterns: [
      /\b(Operations|Ops|Supply\s+Chain|Logistics|Procurement)\b/i,
    ],
  },
  {
    department: 'consulting',
    patterns: [
      /\b(Consultant|Consulting|Advisory|Advisor)\b/i,
    ],
  },
];

/**
 * Parse a title string into structured seniority and department
 *
 * @param {string} title - The LinkedIn title to parse
 * @returns {Object} { seniority, department, normalized }
 *   - seniority: string|null - One of the SENIORITY_LEVELS levels
 *   - department: string|null - One of the DEPARTMENTS departments
 *   - normalized: string - Cleaned/trimmed title
 */
function parseTitle(title) {
  const result = {
    seniority: null,
    department: null,
    normalized: '',
  };

  if (!title || typeof title !== 'string') {
    return result;
  }

  result.normalized = title.trim();

  if (result.normalized === '') {
    return result;
  }

  // Match seniority (first match wins — higher levels checked first)
  for (const { level, patterns } of SENIORITY_LEVELS) {
    for (const pattern of patterns) {
      if (pattern.test(result.normalized)) {
        result.seniority = level;
        break;
      }
    }
    if (result.seniority) break;
  }

  // Match department (first match wins)
  for (const { department, patterns } of DEPARTMENTS) {
    for (const pattern of patterns) {
      if (pattern.test(result.normalized)) {
        result.department = department;
        break;
      }
    }
    if (result.department) break;
  }

  return result;
}

/**
 * Get all valid seniority levels
 * @returns {string[]}
 */
function getSeniorityLevels() {
  return SENIORITY_LEVELS.map((s) => s.level);
}

/**
 * Get all valid department names
 * @returns {string[]}
 */
function getDepartments() {
  return DEPARTMENTS.map((d) => d.department);
}

module.exports = {
  parseTitle,
  getSeniorityLevels,
  getDepartments,
};
