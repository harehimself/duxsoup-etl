/**
 * Title Parser Utility
 *
 * Parses LinkedIn titles into structured seniority tiers and department classifications.
 * Used for enrichment during person snapshot upserts and for query filtering.
 *
 * Seniority Tier System:
 * - Higher tier_rank = more senior position
 * - Matching order is critical: check higher tiers first
 * - For multiple roles, highest tier_rank wins
 */

/**
 * Seniority tier definitions with pattern matching
 * CRITICAL: Order matters - higher tiers must be checked first to avoid false matches
 * tier_rank: 1 (lowest) to 8 (highest)
 */
const SENIORITY_TIERS = [
  {
    tier: "Owner",
    tier_rank: 8,
    patterns: [
      /\b(Founder|Co-?Founder|Owner|Co-?Owner|Sole\s+Proprietor)\b/i,
      // Partner - business ownership only
      // Negative lookbehind to exclude client-facing "Partner" roles
      /\b(?<!Senior\s)(?<!Client\s)(?<!Talent\s)(?<!Success\s)(?<!Account\s)(?<!Sales\s)(?<!Acquisition\s)(Managing\s+)?Partner(?!\s+(Manager|Marketing|Development))\b/i,
      // "Senior Partner" only when standalone (not part of job function)
      /\bSenior\s+Partner(?!\s+(Manager|Marketing|Client|Talent|Account|Acquisition))\b/i,
    ],
    description: "Business owners, founders, and partners",
  },
  {
    tier: "CXO",
    tier_rank: 7,
    patterns: [
      // Match "Chief" followed by any officer title
      /\bChief\s+\w+\s+Officer\b/i,
      /\bChief\b/i,
      // Match C-level abbreviations (CEO, CFO, CTO, etc.)
      /\bC[A-Za-z]O\b/i,
      // Specific C-suite titles
      /\b(CEO|CFO|CTO|COO|CMO|CIO|CISO|CRO|CPO|CDO|CCO|CLO|CHRO|CSO)\b/i,
    ],
    description: "C-suite executives and chiefs",
  },
  {
    tier: "SVP",
    tier_rank: 6,
    patterns: [
      // Senior VP variations (must come before general VP)
      /\b(SVP|S\.V\.P\.)\b/i,
      /\bSenior\s+Vice\s+President\b/i,
      /\bSenior\s+VP\b/i,
      // Executive VP variations
      /\b(EVP|E\.V\.P\.)\b/i,
      /\bExecutive\s+Vice\s+President\b/i,
      /\bExecutive\s+VP\b/i,
      // General Manager (often at SVP level)
      /\bGeneral\s+Manager\b/i,
      /\bGM\b/i,
    ],
    description: "Senior and Executive Vice Presidents, General Managers",
  },
  {
    tier: "VP",
    tier_rank: 5,
    patterns: [
      // Vice President (excluding SVP/EVP which are caught above)
      /\bVice\s+President\b/i,
      /\b(VP|V\.P\.)\b/i,
      // Assistant VP
      /\b(AVP|A\.V\.P\.)\b/i,
      /\bAssistant\s+Vice\s+President\b/i,
      // Head of titles (typically VP-level)
      /\bHead\s+of\b/i,
    ],
    description: "Vice Presidents and Head of titles",
  },
  {
    tier: "Managing Director",
    tier_rank: 4,
    patterns: [
      // Managing Director (must be specific - not just "Director")
      /\bManaging\s+Director\b/i,
      /\bManaging\s+Dir\.?\b/i,
      /\b(MD)\b/i,
    ],
    description: "Managing Directors",
  },
  {
    tier: "Manager",
    tier_rank: 3,
    patterns: [
      /\b(Manager|Mgr\.?)\b/i,
      /\bSenior\s+Manager\b/i,
      /\bSr\.?\s+Manager\b/i,
      /\bTeam\s+Lead\b/i,
      /\bSupervisor\b/i,
      /\bLead\b/i,
      // Director titles (avoiding Managing Director which is rank 4)
      /\bDirector(?!\s+of\s+the\s+Board)\b/i,
      /\bSenior\s+Director\b/i,
      /\bSr\.?\s+Director\b/i,
      /\bExecutive\s+Director\b/i,
      /\bRegional\s+Director\b/i,
      // Specific manager types
      /\b(Program\s+Manager|Project\s+Manager|Product\s+Manager|Engineering\s+Manager)\b/i,
    ],
    description: "Managers, directors, team leads, and supervisors",
  },
  {
    tier: "In Training",
    tier_rank: 2,
    patterns: [
      /\b(Student|Intern|Internship|Apprentice|Trainee|Co-?op|Candidate)\b/i,
      /\bEntry[\s-]?Level\b/i,
    ],
    description: "Students, interns, and trainees",
  },
  {
    tier: "Individual Contributor",
    tier_rank: 1,
    patterns: [
      // This is the default/fallback tier
      // Explicitly match IC-related terms
      /\b(Analyst|Specialist|Coordinator|Associate|Consultant|Engineer|Developer|Designer|Architect)\b/i,
      /\b(Senior|Sr\.?|Staff|Principal)\b/i,
      /\b(Junior|Jr\.?)\b/i,
    ],
    description: "Individual contributors without management responsibilities",
  },
];

/**
 * Department/function definitions with pattern matching
 */
const DEPARTMENTS = [
  {
    department: "engineering",
    patterns: [
      /\b(Engineer|Engineering|Software|Developer|Development|SWE|SDE|DevOps|Backend|Frontend|Full[\s-]?Stack|Platform|Infrastructure|Architect|Technical|Technology)\b/i,
    ],
  },
  {
    department: "data",
    patterns: [
      /\b(Data|Analytics|Data\s+Science|Machine\s+Learning|ML|AI|Artificial\s+Intelligence|BI|Business\s+Intelligence)\b/i,
    ],
  },
  {
    department: "product",
    patterns: [/\b(Product|Product\s+Management|Product\s+Manager|PM)\b/i],
  },
  {
    department: "design",
    patterns: [
      /\b(Design|UX|UI|User\s+Experience|User\s+Interface|Creative|Graphic|Visual)\b/i,
    ],
  },
  {
    department: "marketing",
    patterns: [
      /\b(Marketing|Growth|Brand|Content|Digital\s+Marketing|SEO|SEM|Demand\s+Gen|Communications|PR|Public\s+Relations)\b/i,
    ],
  },
  {
    department: "sales",
    patterns: [
      /\b(Sales|Account\s+Executive|AE|BDR|SDR|Business\s+Development|Revenue|Account\s+Manager|Inside\s+Sales)\b/i,
    ],
  },
  {
    department: "customer_success",
    patterns: [
      /\b(Customer\s+Success|CS|Customer\s+Support|Support|Client\s+Services|Customer\s+Experience|CX)\b/i,
    ],
  },
  {
    department: "finance",
    patterns: [
      /\b(Finance|Accounting|Financial|Controller|Treasury|FP&A|Audit)\b/i,
    ],
  },
  {
    department: "hr",
    patterns: [
      /\b(HR|Human\s+Resources|People\s+Operations|People\s+Ops|Talent|Recruiting|Recruiter|Recruitment)\b/i,
    ],
  },
  {
    department: "legal",
    patterns: [/\b(Legal|Counsel|Attorney|Lawyer|Compliance|Regulatory)\b/i],
  },
  {
    department: "operations",
    patterns: [/\b(Operations|Ops|Supply\s+Chain|Logistics|Procurement)\b/i],
  },
  {
    department: "consulting",
    patterns: [/\b(Consultant|Consulting|Advisory|Advisor)\b/i],
  },
];

/**
 * Parse a title string into structured seniority tier and department
 *
 * @param {string} title - The LinkedIn title to parse
 * @returns {Object} { seniority, seniorityRank, department, normalized }
 *   - seniority: string - Tier name (defaults to "Individual Contributor")
 *   - seniorityRank: number - Tier rank (1-8, higher = more senior)
 *   - department: string|null - Department classification
 *   - normalized: string - Cleaned/trimmed title
 */
function parseTitle(title) {
  const result = {
    seniority: null,
    seniorityRank: null,
    department: null,
    normalized: "",
  };

  // Handle invalid input - return defaults
  if (!title || typeof title !== "string" || title.trim() === "") {
    result.seniority = "Individual Contributor";
    result.seniorityRank = 1;
    return result;
  }

  result.normalized = title.trim();

  // Match seniority tier (first match wins — higher tiers checked first)
  // CRITICAL: Order matters to avoid false matches (e.g., "SVP" must match before "VP")
  for (const { tier, tier_rank, patterns } of SENIORITY_TIERS) {
    for (const pattern of patterns) {
      if (pattern.test(result.normalized)) {
        result.seniority = tier;
        result.seniorityRank = tier_rank;
        break;
      }
    }
    if (result.seniority) break;
  }

  // Default to Individual Contributor if no match found
  if (!result.seniority) {
    result.seniority = "Individual Contributor";
    result.seniorityRank = 1;
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
 * Get all valid seniority tiers (ordered by rank, highest first)
 * @returns {Array<{tier: string, rank: number}>}
 */
function getSeniorityTiers() {
  return SENIORITY_TIERS.map((s) => ({
    tier: s.tier,
    rank: s.tier_rank,
    description: s.description,
  })).sort((a, b) => b.rank - a.rank);
}

/**
 * Get seniority tier names only
 * @returns {string[]}
 */
function getSeniorityTierNames() {
  return SENIORITY_TIERS.map((s) => s.tier);
}

/**
 * Get all valid department names
 * @returns {string[]}
 */
function getDepartments() {
  return DEPARTMENTS.map((d) => d.department);
}

/**
 * Compare two seniority tiers and return the higher one
 * @param {string} tier1 - First tier name
 * @param {string} tier2 - Second tier name
 * @returns {string} The tier with higher rank
 */
function getHigherSeniorityTier(tier1, tier2) {
  if (!tier1) return tier2;
  if (!tier2) return tier1;

  const rank1 = SENIORITY_TIERS.find((t) => t.tier === tier1)?.tier_rank || 0;
  const rank2 = SENIORITY_TIERS.find((t) => t.tier === tier2)?.tier_rank || 0;

  return rank1 >= rank2 ? tier1 : tier2;
}

/**
 * Get the highest seniority tier from an array of roles
 * @param {Array<Object>} roles - Array of role objects with seniority field
 * @returns {Object|null} The role with the highest seniority tier, or null if no roles
 */
function getHighestSeniorityRole(roles) {
  if (!roles || roles.length === 0) return null;

  // Filter roles that have seniority parsed
  const rolesWithSeniority = roles.filter((r) => r.seniority);

  if (rolesWithSeniority.length === 0) return null;

  // Find role with highest tier_rank
  return rolesWithSeniority.reduce((highest, current) => {
    const currentTier = SENIORITY_TIERS.find(
      (t) => t.tier === current.seniority,
    );
    const highestTier = SENIORITY_TIERS.find(
      (t) => t.tier === highest.seniority,
    );

    const currentRank = currentTier?.tier_rank || 0;
    const highestRank = highestTier?.tier_rank || 0;

    return currentRank > highestRank ? current : highest;
  });
}

module.exports = {
  parseTitle,
  getSeniorityTiers,
  getSeniorityTierNames,
  getDepartments,
  getHigherSeniorityTier,
  getHighestSeniorityRole,
  // Legacy exports for backward compatibility
  getSeniorityLevels: getSeniorityTierNames,
};
