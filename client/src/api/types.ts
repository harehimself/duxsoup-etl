// ----- Shared envelopes -----
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  total?: number;
  limit?: number;
  offset?: number;
}

// ----- Person -----
export interface PersonAlias {
  type: string;
  value: string;
}

export interface PersonRole {
  title?: string;
  companyName?: string;
  companyId?: string;
  location?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  seniority?: string;
  seniorityRank?: number;
}

export interface PersonEducation {
  school?: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
}

export interface PersonSnapshot {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  birthday?: string;
  currentTitle?: string;
  currentCompany?: string;
  currentCompanyId?: string;
  currentCompanyUrl?: string;
  currentCompanyProfile?: string;
  parsedSeniority?: string;
  parsedDepartment?: string;
  location?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  country?: string;
  countryCode?: string;
  province?: string;
  region?: string;
  locationType?: string;
  usRegion?: string;
  usSubregion?: string;
  timezone?: string;
  utcOffset?: number;
  industry?: string;
  connections?: number;
  summary?: string;
  email?: string;
  phone?: string;
  twitter?: string;
  profilePicture?: string;
  thumbnail?: string;
  roles?: PersonRole[];
  education?: PersonEducation[];
  skills?: string[];
  personalWebsite?: string;
  companyWebsite?: string;
  degree?: string;
}

export interface PersonDerived {
  avgTenureMonths?: number;
  yearsAtCurrentCompany?: number;
  highestSeniority?: string;
  highestSeniorityRank?: number;
  highestSeniorityRoleTitle?: string;
  highestSeniorityRoleCompany?: string;
  leadScore?: number;
  segment?: string;
}

export interface PersonMeta {
  lastObservedAt?: string;
  lastObservation?: {
    type: string;
    id: string;
    observedAt: string;
  };
  observationsCount?: number;
}

export interface Person {
  _id: string;
  canonical_id?: string;
  aliases?: PersonAlias[];
  snapshot: PersonSnapshot;
  derived?: PersonDerived;
  meta?: PersonMeta;
  mergedInto?: string;
  mergedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ----- Company -----
export interface Company {
  _id: string;
  canonical_id?: string;
  aliases?: PersonAlias[];
  snapshot: {
    name?: string;
    linkedInUrl?: string;
    industry?: string;
    website?: string;
    specialties?: string[];
    description?: string;
    headcount?: number;
    type?: string;
  };
  meta?: {
    lastObservedAt?: string;
    observationsCount?: number;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface CompanyIntelligence {
  company: Company;
  headcount: number;
  seniorityDistribution: Array<{ tier: string; count: number }>;
  departmentDistribution: Array<{ department: string; count: number }>;
  recentHires: number;
  recentDepartures: number;
  avgTenureMonths: number;
  hiringVelocity: number;
  decisionMakers: Array<{
    name: string;
    title: string;
    seniority: string;
    personId: string;
  }>;
  geographyDistribution: Array<{ location: string; count: number }>;
}

// ----- Signals -----
export interface Signal {
  type: string;
  personId: string;
  personName: string;
  title?: string;
  previousTitle?: string;
  company?: string;
  previousCompany?: string;
  companyId?: string;
  seniority?: string;
  seniorityRank?: number;
  detectedAt: string;
  actionContext?: string;
}

// ----- Changes -----
export interface Change {
  _id: string;
  personId: string;
  personName?: string;
  changeType: string;
  field?: string;
  before?: string;
  after?: string;
  detectedAt: string;
  observationId?: string;
}

// ----- Timeline -----
export interface TimelineEvent {
  type: "visit" | "scan" | "change";
  timestamp: string;
  id: string;
  data: Record<string, unknown>;
}

// ----- Health -----
export interface DashboardHealth {
  status: string;
  database: { readyState: number; readyStateText: string };
  counts: {
    people: number;
    companies: number;
    locations: number;
    visits: number;
    scans: number;
    deadLetters: number;
  };
  ingestion: {
    last24h: {
      visits: number;
      scans: number;
    };
    successRate: number;
  };
}

export interface ThroughputData {
  windows: {
    "1m": number;
    "5m": number;
    "15m": number;
    "1h": number;
  };
  history?: Array<{ timestamp: string; count: number }>;
}

export interface DataQuality {
  totalPeople: number;
  fields: Array<{
    field: string;
    present: number;
    missing: number;
    percentPresent: number;
  }>;
}

export interface DataCleanliness {
  totalPeople: number;
  issues: {
    whitespace: number;
    invalidEmail: number;
    duplicateSkills: number;
    duplicateEducation: number;
    missingFields: Record<string, number>;
  };
}

// ----- Insights -----
export interface NetworkProfile {
  totalConnections: number;
  distributions: {
    company: Array<{ name: string; count: number }>;
    seniority: Array<{ tier: string; count: number }>;
    title: Array<{ title: string; count: number }>;
    industry: Array<{ industry: string; count: number }>;
    geography: Array<{ location: string; count: number }>;
    department: Array<{ department: string; count: number }>;
  };
}

export interface NetworkTrends {
  current: NetworkProfile;
  windows: Record<
    string,
    {
      total: number;
      growthRate: number;
      insights: string[];
    }
  >;
}

export interface EnrichmentGaps {
  totalPeople: number;
  fields: Array<{
    field: string;
    missing: number;
    percentMissing: number;
  }>;
}

// ----- Seniority -----
export interface SeniorityDistribution {
  tiers: Array<{
    tier: string;
    rank: number;
    count: number;
    percentage: number;
  }>;
  total: number;
}

export interface SeniorityStats {
  distribution: SeniorityDistribution;
  topCompanies: Array<{
    company: string;
    seniorLeaderCount: number;
  }>;
}

// ----- Query -----
export interface QueryRequest {
  filters: Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  fields?: string[];
}

// ----- Export -----
export interface ExportJob {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  downloadUrl?: string;
  total?: number;
  error?: string;
}
