const {
  parseTitle,
  getSeniorityTiers,
  getSeniorityTierNames,
  getDepartments,
  getHigherSeniorityTier,
  getHighestSeniorityRole,
} = require("../../src/utils/titleParser");

describe("titleParser", () => {
  describe("parseTitle()", () => {
    describe("Owner tier (rank 8)", () => {
      it("should classify Founder as Owner", () => {
        const result = parseTitle("Founder & CEO");
        expect(result.seniority).toBe("Owner");
        expect(result.seniorityRank).toBe(8);
      });

      it("should classify Co-Founder as Owner", () => {
        const result = parseTitle("Co-Founder");
        expect(result.seniority).toBe("Owner");
        expect(result.seniorityRank).toBe(8);
      });

      it("should classify Owner as Owner", () => {
        const result = parseTitle("Owner");
        expect(result.seniority).toBe("Owner");
        expect(result.seniorityRank).toBe(8);
      });

      it("should classify Partner as Owner", () => {
        const result = parseTitle("Partner");
        expect(result.seniority).toBe("Owner");
        expect(result.seniorityRank).toBe(8);
      });

      it("should classify Sole Proprietor as Owner", () => {
        const result = parseTitle("Sole Proprietor");
        expect(result.seniority).toBe("Owner");
        expect(result.seniorityRank).toBe(8);
      });

      it("should not classify Partner Manager as Owner", () => {
        const result = parseTitle("Partner Manager");
        expect(result.seniority).not.toBe("Owner");
      });
    });

    describe("CXO tier (rank 7)", () => {
      it("should classify CEO as CXO", () => {
        const result = parseTitle("CEO");
        expect(result.seniority).toBe("CXO");
        expect(result.seniorityRank).toBe(7);
      });

      it("should classify CTO as CXO", () => {
        const result = parseTitle("Chief Technology Officer");
        expect(result.seniority).toBe("CXO");
        expect(result.seniorityRank).toBe(7);
      });

      it("should classify CFO as CXO", () => {
        const result = parseTitle("CFO");
        expect(result.seniority).toBe("CXO");
        expect(result.seniorityRank).toBe(7);
      });

      it("should classify Chief with any title as CXO", () => {
        const result = parseTitle("Chief Innovation Officer");
        expect(result.seniority).toBe("CXO");
        expect(result.seniorityRank).toBe(7);
      });

      it("should classify CMO as CXO", () => {
        const result = parseTitle("CMO");
        expect(result.seniority).toBe("CXO");
        expect(result.seniorityRank).toBe(7);
      });

      it('should classify lowercase "ceo" as CXO', () => {
        const result = parseTitle("ceo");
        expect(result.seniority).toBe("CXO");
        expect(result.seniorityRank).toBe(7);
      });

      it('should classify mixed-case "Cto" as CXO', () => {
        const result = parseTitle("Cto");
        expect(result.seniority).toBe("CXO");
        expect(result.seniorityRank).toBe(7);
      });

      it('should classify lowercase "cfo" as CXO', () => {
        const result = parseTitle("cfo");
        expect(result.seniority).toBe("CXO");
        expect(result.seniorityRank).toBe(7);
      });
    });

    describe("SVP tier (rank 6)", () => {
      it("should classify SVP as SVP tier", () => {
        const result = parseTitle("SVP of Engineering");
        expect(result.seniority).toBe("SVP");
        expect(result.seniorityRank).toBe(6);
      });

      it("should classify Senior Vice President as SVP tier", () => {
        const result = parseTitle("Senior Vice President");
        expect(result.seniority).toBe("SVP");
        expect(result.seniorityRank).toBe(6);
      });

      it("should classify EVP as SVP tier", () => {
        const result = parseTitle("EVP, Sales");
        expect(result.seniority).toBe("SVP");
        expect(result.seniorityRank).toBe(6);
      });

      it("should classify Executive Vice President as SVP tier", () => {
        const result = parseTitle("Executive Vice President");
        expect(result.seniority).toBe("SVP");
        expect(result.seniorityRank).toBe(6);
      });

      it("should classify General Manager as SVP tier", () => {
        const result = parseTitle("General Manager");
        expect(result.seniority).toBe("SVP");
        expect(result.seniorityRank).toBe(6);
      });

      it("should classify GM as SVP tier", () => {
        const result = parseTitle("GM");
        expect(result.seniority).toBe("SVP");
        expect(result.seniorityRank).toBe(6);
      });

      it('should classify lowercase "gm" as SVP tier', () => {
        const result = parseTitle("gm");
        expect(result.seniority).toBe("SVP");
        expect(result.seniorityRank).toBe(6);
      });
    });

    describe("VP tier (rank 5)", () => {
      it("should classify Vice President as VP tier", () => {
        const result = parseTitle("Vice President of Marketing");
        expect(result.seniority).toBe("VP");
        expect(result.seniorityRank).toBe(5);
      });

      it("should classify VP as VP tier", () => {
        const result = parseTitle("VP, Product");
        expect(result.seniority).toBe("VP");
        expect(result.seniorityRank).toBe(5);
      });

      it("should classify RVP as VP tier", () => {
        const result = parseTitle("RVP Sales, Intelligent Self Service");
        expect(result.seniority).toBe("VP");
        expect(result.seniorityRank).toBe(5);
      });

      it("should classify lowercase rvp as VP tier", () => {
        const result = parseTitle("rvp of enterprise sales");
        expect(result.seniority).toBe("VP");
        expect(result.seniorityRank).toBe(5);
      });

      it("should classify Regional Vice President as VP tier", () => {
        const result = parseTitle("Regional Vice President, Sales");
        expect(result.seniority).toBe("VP");
        expect(result.seniorityRank).toBe(5);
      });

      it("should classify AVP as VP tier", () => {
        const result = parseTitle("AVP of Operations");
        expect(result.seniority).toBe("VP");
        expect(result.seniorityRank).toBe(5);
      });

      it("should classify Head of as VP tier", () => {
        const result = parseTitle("Head of Data Science");
        expect(result.seniority).toBe("VP");
        expect(result.seniorityRank).toBe(5);
      });

      it("should NOT match SVP as VP tier", () => {
        const result = parseTitle("SVP of Sales");
        expect(result.seniority).toBe("SVP");
        expect(result.seniorityRank).toBe(6);
      });
    });

    describe("Managing Director tier (rank 4)", () => {
      it("should classify Managing Director as Managing Director tier", () => {
        const result = parseTitle("Managing Director");
        expect(result.seniority).toBe("Managing Director");
        expect(result.seniorityRank).toBe(4);
      });

      it("should classify Managing Dir. as Managing Director tier", () => {
        const result = parseTitle("Managing Dir.");
        expect(result.seniority).toBe("Managing Director");
        expect(result.seniorityRank).toBe(4);
      });

      it("should classify MD as Managing Director tier", () => {
        const result = parseTitle("MD");
        expect(result.seniority).toBe("Managing Director");
        expect(result.seniorityRank).toBe(4);
      });

      it('should classify lowercase "md" as Managing Director tier', () => {
        const result = parseTitle("md");
        expect(result.seniority).toBe("Managing Director");
        expect(result.seniorityRank).toBe(4);
      });

      it("should NOT match just Director as Managing Director tier", () => {
        const result = parseTitle("Director of Engineering");
        expect(result.seniority).not.toBe("Managing Director");
      });
    });

    describe("Manager tier (rank 3)", () => {
      it("should classify Manager as Manager tier", () => {
        const result = parseTitle("Manager");
        expect(result.seniority).toBe("Manager");
        expect(result.seniorityRank).toBe(3);
      });

      it("should classify Senior Manager as Manager tier", () => {
        const result = parseTitle("Senior Manager");
        expect(result.seniority).toBe("Manager");
        expect(result.seniorityRank).toBe(3);
      });

      it("should classify Team Lead as Manager tier", () => {
        const result = parseTitle("Team Lead");
        expect(result.seniority).toBe("Manager");
        expect(result.seniorityRank).toBe(3);
      });

      it("should classify Supervisor as Manager tier", () => {
        const result = parseTitle("Supervisor");
        expect(result.seniority).toBe("Manager");
        expect(result.seniorityRank).toBe(3);
      });

      it("should classify Program Manager as Manager tier", () => {
        const result = parseTitle("Program Manager");
        expect(result.seniority).toBe("Manager");
        expect(result.seniorityRank).toBe(3);
      });

      it("should classify Product Manager as Manager tier", () => {
        const result = parseTitle("Product Manager");
        expect(result.seniority).toBe("Manager");
        expect(result.seniorityRank).toBe(3);
      });
    });

    describe("In Training tier (rank 2)", () => {
      it("should classify Student as In Training", () => {
        const result = parseTitle("Student");
        expect(result.seniority).toBe("In Training");
        expect(result.seniorityRank).toBe(2);
      });

      it("should classify Intern as In Training", () => {
        const result = parseTitle("Software Engineering Intern");
        expect(result.seniority).toBe("In Training");
        expect(result.seniorityRank).toBe(2);
      });

      it("should classify Apprentice as In Training", () => {
        const result = parseTitle("Apprentice");
        expect(result.seniority).toBe("In Training");
        expect(result.seniorityRank).toBe(2);
      });

      it("should classify Trainee as In Training", () => {
        const result = parseTitle("Trainee");
        expect(result.seniority).toBe("In Training");
        expect(result.seniorityRank).toBe(2);
      });

      it("should classify Candidate as In Training", () => {
        const result = parseTitle("MBA Candidate");
        expect(result.seniority).toBe("In Training");
        expect(result.seniorityRank).toBe(2);
      });
    });

    describe("Individual Contributor tier (rank 1 - default)", () => {
      it("should default to Individual Contributor for Engineer", () => {
        const result = parseTitle("Software Engineer");
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });

      it("should default to Individual Contributor for Senior Engineer", () => {
        const result = parseTitle("Senior Software Engineer");
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });

      it("should default to Individual Contributor for Staff Engineer", () => {
        const result = parseTitle("Staff Engineer");
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });

      it("should default to Individual Contributor for Principal Engineer", () => {
        const result = parseTitle("Principal Engineer");
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });

      it("should default to Individual Contributor for Analyst", () => {
        const result = parseTitle("Data Analyst");
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });

      it("should default to Individual Contributor for Designer", () => {
        const result = parseTitle("UX Designer");
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });

      it("should default to Individual Contributor for unrecognized titles", () => {
        const result = parseTitle("Ninja Rockstar Wizard");
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });
    });

    describe("Edge cases and precedence", () => {
      it("should prioritize Owner over CXO (Founder & CEO)", () => {
        const result = parseTitle("Founder & CEO");
        expect(result.seniority).toBe("Owner");
        expect(result.seniorityRank).toBe(8);
      });

      it("should prioritize SVP over VP", () => {
        const result = parseTitle("Senior Vice President");
        expect(result.seniority).toBe("SVP");
        expect(result.seniorityRank).toBe(6);
      });

      it("should handle empty string", () => {
        const result = parseTitle("");
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });

      it("should handle null", () => {
        const result = parseTitle(null);
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });

      it("should handle undefined", () => {
        const result = parseTitle(undefined);
        expect(result.seniority).toBe("Individual Contributor");
        expect(result.seniorityRank).toBe(1);
      });
    });

    describe("Department parsing", () => {
      it("should parse engineering department", () => {
        const result = parseTitle("Senior Software Engineer");
        expect(result.department).toBe("engineering");
      });

      it("should parse sales department", () => {
        const result = parseTitle("VP of Sales");
        expect(result.department).toBe("sales");
      });

      it("should parse both seniority and department", () => {
        const result = parseTitle("Chief Technology Officer");
        expect(result.seniority).toBe("CXO");
        expect(result.department).toBe("engineering");
      });
    });
  });

  describe("getHigherSeniorityTier()", () => {
    it("should return CXO over VP", () => {
      const result = getHigherSeniorityTier("CXO", "VP");
      expect(result).toBe("CXO");
    });

    it("should return Owner over CXO", () => {
      const result = getHigherSeniorityTier("Owner", "CXO");
      expect(result).toBe("Owner");
    });

    it("should return Manager over Individual Contributor", () => {
      const result = getHigherSeniorityTier(
        "Manager",
        "Individual Contributor",
      );
      expect(result).toBe("Manager");
    });

    it("should handle null values", () => {
      expect(getHigherSeniorityTier(null, "VP")).toBe("VP");
      expect(getHigherSeniorityTier("VP", null)).toBe("VP");
    });
  });

  describe("getHighestSeniorityRole()", () => {
    it("should return role with highest seniority rank", () => {
      const roles = [
        {
          title: "Software Engineer",
          seniority: "Individual Contributor",
          seniorityRank: 1,
        },
        { title: "VP of Engineering", seniority: "VP", seniorityRank: 5 },
        { title: "Manager", seniority: "Manager", seniorityRank: 3 },
      ];

      const result = getHighestSeniorityRole(roles);
      expect(result.title).toBe("VP of Engineering");
      expect(result.seniority).toBe("VP");
    });

    it("should return Owner over CXO", () => {
      const roles = [
        { title: "CEO", seniority: "CXO", seniorityRank: 7 },
        { title: "Founder", seniority: "Owner", seniorityRank: 8 },
      ];

      const result = getHighestSeniorityRole(roles);
      expect(result.title).toBe("Founder");
      expect(result.seniority).toBe("Owner");
    });

    it("should return first role when ranks are equal", () => {
      const roles = [
        { title: "VP of Sales", seniority: "VP", seniorityRank: 5 },
        { title: "VP of Marketing", seniority: "VP", seniorityRank: 5 },
      ];

      const result = getHighestSeniorityRole(roles);
      expect(result.title).toBe("VP of Sales");
    });

    it("should return null for empty array", () => {
      const result = getHighestSeniorityRole([]);
      expect(result).toBeNull();
    });

    it("should return null for null input", () => {
      const result = getHighestSeniorityRole(null);
      expect(result).toBeNull();
    });

    it("should ignore roles without seniority", () => {
      const roles = [
        { title: "Software Engineer" }, // No seniority field
        { title: "Manager", seniority: "Manager", seniorityRank: 3 },
      ];

      const result = getHighestSeniorityRole(roles);
      expect(result.title).toBe("Manager");
    });
  });

  describe("getSeniorityTiers()", () => {
    it("should return all tiers sorted by rank descending", () => {
      const tiers = getSeniorityTiers();
      expect(tiers.length).toBe(8);
      expect(tiers[0].tier).toBe("Owner");
      expect(tiers[0].rank).toBe(8);
      expect(tiers[7].tier).toBe("Individual Contributor");
      expect(tiers[7].rank).toBe(1);
    });
  });

  describe("getSeniorityTierNames()", () => {
    it("should return all tier names", () => {
      const names = getSeniorityTierNames();
      expect(names).toContain("Owner");
      expect(names).toContain("CXO");
      expect(names).toContain("SVP");
      expect(names).toContain("VP");
      expect(names).toContain("Managing Director");
      expect(names).toContain("Manager");
      expect(names).toContain("In Training");
      expect(names).toContain("Individual Contributor");
    });
  });

  describe("getDepartments()", () => {
    it("should return array of department names", () => {
      const depts = getDepartments();
      expect(Array.isArray(depts)).toBe(true);
      expect(depts).toContain("engineering");
      expect(depts).toContain("sales");
      expect(depts).toContain("marketing");
    });
  });
});
