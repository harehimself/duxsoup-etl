const { parseTitle, getSeniorityLevels, getDepartments } = require('../../src/utils/titleParser');

describe('titleParser', () => {
  describe('parseTitle()', () => {
    // Null/empty handling
    it('should return nulls for null input', () => {
      const result = parseTitle(null);
      expect(result.seniority).toBeNull();
      expect(result.department).toBeNull();
      expect(result.normalized).toBe('');
    });

    it('should return nulls for empty string', () => {
      const result = parseTitle('');
      expect(result.seniority).toBeNull();
      expect(result.department).toBeNull();
    });

    it('should return nulls for whitespace-only string', () => {
      const result = parseTitle('   ');
      expect(result.seniority).toBeNull();
      expect(result.department).toBeNull();
    });

    it('should return nulls for non-string input', () => {
      const result = parseTitle(123);
      expect(result.seniority).toBeNull();
      expect(result.department).toBeNull();
    });

    // C-Suite detection
    it('should detect CEO as c-suite', () => {
      expect(parseTitle('CEO').seniority).toBe('c-suite');
    });

    it('should detect Chief Technology Officer as c-suite', () => {
      expect(parseTitle('Chief Technology Officer').seniority).toBe('c-suite');
    });

    it('should detect CTO as c-suite', () => {
      expect(parseTitle('CTO at Acme Inc').seniority).toBe('c-suite');
    });

    // Founder detection
    it('should detect Founder', () => {
      expect(parseTitle('Founder & CEO').seniority).toBe('c-suite'); // CEO takes precedence (checked first)
    });

    it('should detect Co-Founder', () => {
      expect(parseTitle('Co-Founder').seniority).toBe('founder');
    });

    // VP detection
    it('should detect VP', () => {
      expect(parseTitle('VP of Engineering').seniority).toBe('vp');
    });

    it('should detect Vice President', () => {
      expect(parseTitle('Vice President, Sales').seniority).toBe('vp');
    });

    it('should detect SVP', () => {
      expect(parseTitle('SVP of Product').seniority).toBe('vp');
    });

    // Director detection
    it('should detect Director', () => {
      expect(parseTitle('Director of Marketing').seniority).toBe('director');
    });

    it('should detect Senior Director', () => {
      expect(parseTitle('Senior Director, Engineering').seniority).toBe('director');
    });

    // Head detection
    it('should detect Head of', () => {
      expect(parseTitle('Head of Design').seniority).toBe('head');
    });

    // Manager detection
    it('should detect Manager', () => {
      expect(parseTitle('Engineering Manager').seniority).toBe('manager');
    });

    it('should detect Product Manager', () => {
      expect(parseTitle('Product Manager').seniority).toBe('manager');
    });

    // Lead detection
    it('should detect Lead', () => {
      expect(parseTitle('Tech Lead').seniority).toBe('lead');
    });

    it('should detect Principal', () => {
      expect(parseTitle('Principal Engineer').seniority).toBe('lead');
    });

    // Senior detection
    it('should detect Senior', () => {
      expect(parseTitle('Senior Software Engineer').seniority).toBe('senior');
    });

    it('should detect Sr.', () => {
      expect(parseTitle('Sr. Data Analyst').seniority).toBe('senior');
    });

    // Junior detection
    it('should detect Junior', () => {
      expect(parseTitle('Junior Developer').seniority).toBe('junior');
    });

    it('should detect Associate', () => {
      expect(parseTitle('Associate Analyst').seniority).toBe('junior');
    });

    // Intern detection
    it('should detect Intern', () => {
      expect(parseTitle('Software Engineering Intern').seniority).toBe('intern');
    });

    // Department detection
    it('should detect engineering department', () => {
      expect(parseTitle('Software Engineer').department).toBe('engineering');
    });

    it('should detect data department', () => {
      expect(parseTitle('Data Scientist').department).toBe('data');
    });

    it('should detect product department', () => {
      expect(parseTitle('Product Manager').department).toBe('product');
    });

    it('should detect design department', () => {
      expect(parseTitle('UX Designer').department).toBe('design');
    });

    it('should detect marketing department', () => {
      expect(parseTitle('Digital Marketing Manager').department).toBe('marketing');
    });

    it('should detect sales department', () => {
      expect(parseTitle('Account Executive').department).toBe('sales');
    });

    it('should detect finance department', () => {
      expect(parseTitle('Financial Analyst').department).toBe('finance');
    });

    it('should detect hr department', () => {
      expect(parseTitle('Talent Acquisition Specialist').department).toBe('hr');
    });

    it('should detect legal department', () => {
      expect(parseTitle('General Counsel').department).toBe('legal');
    });

    it('should detect operations department', () => {
      expect(parseTitle('Operations Manager').department).toBe('operations');
    });

    it('should detect consulting department', () => {
      expect(parseTitle('Management Consultant').department).toBe('consulting');
    });

    // Combined detection
    it('should detect both seniority and department', () => {
      const result = parseTitle('Senior Software Engineer');
      expect(result.seniority).toBe('senior');
      expect(result.department).toBe('engineering');
    });

    it('should detect VP of Engineering', () => {
      const result = parseTitle('VP of Engineering');
      expect(result.seniority).toBe('vp');
      expect(result.department).toBe('engineering');
    });

    it('should detect Director of Marketing', () => {
      const result = parseTitle('Director of Marketing');
      expect(result.seniority).toBe('director');
      expect(result.department).toBe('marketing');
    });

    // Normalized output
    it('should trim the title in normalized field', () => {
      expect(parseTitle('  VP of Sales  ').normalized).toBe('VP of Sales');
    });

    // Titles with no match
    it('should return null seniority for unrecognized title', () => {
      expect(parseTitle('Barista').seniority).toBeNull();
    });

    it('should return null department for unrecognized title', () => {
      expect(parseTitle('Barista').department).toBeNull();
    });
  });

  describe('getSeniorityLevels()', () => {
    it('should return an array of strings', () => {
      const levels = getSeniorityLevels();
      expect(Array.isArray(levels)).toBe(true);
      expect(levels.length).toBeGreaterThan(0);
      levels.forEach((l) => expect(typeof l).toBe('string'));
    });

    it('should include known levels', () => {
      const levels = getSeniorityLevels();
      expect(levels).toContain('c-suite');
      expect(levels).toContain('vp');
      expect(levels).toContain('director');
      expect(levels).toContain('senior');
      expect(levels).toContain('junior');
    });
  });

  describe('getDepartments()', () => {
    it('should return an array of strings', () => {
      const depts = getDepartments();
      expect(Array.isArray(depts)).toBe(true);
      expect(depts.length).toBeGreaterThan(0);
      depts.forEach((d) => expect(typeof d).toBe('string'));
    });

    it('should include known departments', () => {
      const depts = getDepartments();
      expect(depts).toContain('engineering');
      expect(depts).toContain('sales');
      expect(depts).toContain('marketing');
      expect(depts).toContain('finance');
    });
  });
});
