const {
  extractSalesNavId,
  extractNumericId,
  extractPublicProfileUrl,
  extractCompanyId,
  resolvePersonIdentity,
  resolveCompanyIdentity,
} = require('../utils/identityResolver');

describe('Identity Resolution Utility', () => {
  describe('extractSalesNavId()', () => {
    it('should extract Sales Navigator ID from sales lead URL', () => {
      const url = 'https://www.linkedin.com/sales/lead/ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ,NAME_SEARCH,vVb7';
      const result = extractSalesNavId(url);

      expect(result).toBe('ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ');
    });

    it('should extract Sales Navigator ID from recruiter profile URL', () => {
      const url = 'https://www.linkedin.com/talent/profile/ACwAAABCDEFGHIJ';
      const result = extractSalesNavId(url);

      expect(result).toBe('ACwAAABCDEFGHIJ');
    });

    it('should return null for public profile URL', () => {
      const url = 'https://www.linkedin.com/in/johndoe';
      const result = extractSalesNavId(url);

      expect(result).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(extractSalesNavId(null)).toBeNull();
      expect(extractSalesNavId('')).toBeNull();
      expect(extractSalesNavId(123)).toBeNull();
    });
  });

  describe('extractNumericId()', () => {
    it('should extract numeric member ID from profile URL', () => {
      const url = 'https://www.linkedin.com/profile/12345678';
      const result = extractNumericId(url);

      expect(result).toBe('12345678');
    });

    it('should return null when no numeric ID present', () => {
      const url = 'https://www.linkedin.com/in/johndoe';
      const result = extractNumericId(url);

      expect(result).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(extractNumericId(null)).toBeNull();
      expect(extractNumericId('')).toBeNull();
    });
  });

  describe('extractPublicProfileUrl()', () => {
    it('should extract and normalize public profile username', () => {
      const url = 'https://www.linkedin.com/in/johndoe/';
      const result = extractPublicProfileUrl(url);

      expect(result).toBe('linkedin.com/in/johndoe');
    });

    it('should handle URLs without trailing slash', () => {
      const url = 'https://linkedin.com/in/janedoe';
      const result = extractPublicProfileUrl(url);

      expect(result).toBe('linkedin.com/in/janedoe');
    });

    it('should handle /pub/ URLs', () => {
      const url = 'https://www.linkedin.com/pub/john-smith';
      const result = extractPublicProfileUrl(url);

      expect(result).toBe('linkedin.com/pub/john-smith');
    });

    it('should return null for Sales Navigator URLs', () => {
      const url = 'https://www.linkedin.com/sales/lead/ACwAAABCDEF';
      const result = extractPublicProfileUrl(url);

      expect(result).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(extractPublicProfileUrl(null)).toBeNull();
      expect(extractPublicProfileUrl('')).toBeNull();
    });
  });

  describe('extractCompanyId()', () => {
    it('should extract numeric company ID', () => {
      const companyId = '12345678';
      const result = extractCompanyId(companyId);

      expect(result).toBe('12345678');
    });

    it('should return null for non-numeric company ID', () => {
      const companyId = 'TechCorp';
      const result = extractCompanyId(companyId);

      expect(result).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(extractCompanyId(null)).toBeNull();
      expect(extractCompanyId('')).toBeNull();
    });
  });

  describe('resolvePersonIdentity()', () => {
    it('should use Sales Navigator ID as primary identity', () => {
      const webhookData = {
        SalesProfile: 'https://www.linkedin.com/sales/lead/ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ,NAME_SEARCH,vVb7',
        Profile: 'https://www.linkedin.com/in/johndoe',
        PublicProfile: 'https://www.linkedin.com/in/johndoe',
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe('ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ');
      expect(result.source).toBe('salesNavId');
      expect(result.aliases).toContainEqual({
        type: 'salesNavId',
        value: 'ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ',
      });
    });

    it('should fallback to RecruiterProfile when SalesProfile missing', () => {
      const webhookData = {
        RecruiterProfile: 'https://www.linkedin.com/talent/profile/ACwAAABCDEFGHIJ',
        Profile: 'https://www.linkedin.com/in/janedoe',
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe('ACwAAABCDEFGHIJ');
      expect(result.source).toBe('recruiterUrl');
    });

    it('should fallback to numeric ID when Sales Navigator ID unavailable', () => {
      const webhookData = {
        Profile: 'https://www.linkedin.com/profile/87654321',
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe('87654321');
      expect(result.source).toBe('numericId');
    });

    it('should fallback to public profile URL when no stable ID exists', () => {
      const webhookData = {
        Profile: 'https://www.linkedin.com/in/johndoe',
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe('linkedin.com/in/johndoe');
      expect(result.source).toBe('publicUrl');
    });

    it('should collect all aliases from multiple profile fields', () => {
      const webhookData = {
        SalesProfile: 'https://www.linkedin.com/sales/lead/ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ,NAME_SEARCH,vVb7',
        Profile: 'https://www.linkedin.com/in/johndoe',
        PublicProfile: 'https://www.linkedin.com/in/john-doe',
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.aliases.length).toBeGreaterThanOrEqual(3);
      expect(result.aliases).toContainEqual(
        expect.objectContaining({ type: 'salesNavId' })
      );
      expect(result.aliases).toContainEqual(
        expect.objectContaining({ type: 'publicUrl', value: 'linkedin.com/in/johndoe' })
      );
    });

    it('should compute canonical_id for sales nav identity', () => {
      const webhookData = {
        SalesProfile: 'https://www.linkedin.com/sales/lead/ACwAAA_TEST123',
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.canonical_id).toBeTruthy();
      expect(result.canonical_key).toBe('salesNavId:ACwAAA_TEST123');
      expect(result.primary_id_type).toBe('salesNavId');
    });

    it('should compute same canonical_id across equivalent sales nav sources', () => {
      const bySalesProfile = resolvePersonIdentity({
        SalesProfile: 'https://www.linkedin.com/sales/lead/ACwAAA_SHARED',
      });

      const byProfile = resolvePersonIdentity({
        Profile: 'https://www.linkedin.com/sales/lead/ACwAAA_SHARED',
      });

      expect(bySalesProfile.canonical_id).toBe(byProfile.canonical_id);
      expect(bySalesProfile.canonical_key).toBe('salesNavId:ACwAAA_SHARED');
      expect(byProfile.canonical_key).toBe('salesNavId:ACwAAA_SHARED');
    });

    it('should return null person_id when no identifiers present', () => {
      const webhookData = {
        'First Name': 'John',
        'Last Name': 'Doe',
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBeNull();
      expect(result.source).toBeNull();
      expect(result.aliases).toEqual([]);
    });
  });

  describe('resolveCompanyIdentity()', () => {
    it('should use numeric CompanyID as primary identity', () => {
      const webhookData = {
        CompanyID: '12345678',
        Company: 'TechCorp',
        CompanyProfile: 'https://www.linkedin.com/company/techcorp',
      };

      const result = resolveCompanyIdentity(webhookData);

      expect(result.company_id).toBe('12345678');
      expect(result.source).toBe('numericId');
      expect(result.aliases).toContainEqual({
        type: 'numericId',
        value: '12345678',
      });
    });

    it('should fallback to company name when CompanyID missing', () => {
      const webhookData = {
        Company: 'TechCorp',
      };

      const result = resolveCompanyIdentity(webhookData);

      expect(result.company_id).toBe('TechCorp');
      expect(result.source).toBe('name');
    });

    it('should include company profile URL as alias', () => {
      const webhookData = {
        CompanyID: '12345678',
        Company: 'TechCorp',
        CompanyProfile: 'https://www.linkedin.com/company/techcorp',
      };

      const result = resolveCompanyIdentity(webhookData);

      expect(result.aliases).toContainEqual({
        type: 'profileUrl',
        value: 'https://www.linkedin.com/company/techcorp',
      });
    });

    it('should return null company_id when no identifiers present', () => {
      const webhookData = {
        'First Name': 'John',
      };

      const result = resolveCompanyIdentity(webhookData);

      expect(result.company_id).toBeNull();
      expect(result.source).toBeNull();
    });
  });
});
