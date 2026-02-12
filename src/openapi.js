/**
 * OpenAPI 3.0 specification for the DuxSoup ETL API.
 *
 * Serves as the source-of-truth API reference and powers the
 * interactive Swagger UI available at /api/docs.
 */
const spec = {
  openapi: "3.0.3",
  info: {
    title: "DuxSoup ETL API",
    version: "1.0.0",
    description:
      "ETL system for processing DuxSoup LinkedIn webhook data into canonical people, company, and location snapshots.",
    license: { name: "MIT" },
  },
  servers: [{ url: "/", description: "Current server" }],

  tags: [
    { name: "Webhook", description: "DuxSoup webhook ingestion" },
    { name: "People", description: "Person snapshot lookups" },
    { name: "Companies", description: "Company snapshot lookups" },
    { name: "Locations", description: "Location snapshot lookups" },
    { name: "Query", description: "Filter and query records" },
    { name: "Search", description: "Full-text search" },
    { name: "Export", description: "Async CSV/JSON export" },
    { name: "Changes", description: "Job change tracking" },
    { name: "Seniority", description: "Seniority tier analysis" },
    { name: "Signals", description: "Engagement trigger feed" },
    { name: "Health", description: "System health and monitoring" },
    { name: "Admin", description: "Administrative operations (auth required)" },
  ],

  // ── Reusable components ─────────────────────────────────────────
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Authorization header required for admin endpoints",
      },
    },

    schemas: {
      // ── Alias ───────────────────────────────────────────────────
      Alias: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "salesNavId",
              "numericId",
              "publicUrl",
              "salesUrl",
              "recruiterUrl",
              "username",
            ],
          },
          value: { type: "string" },
          addedAt: { type: "string", format: "date-time" },
        },
      },

      // ── Provenance ──────────────────────────────────────────────
      ProvenanceEntry: {
        type: "object",
        properties: {
          value: {},
          observedAt: { type: "string", format: "date-time" },
          source: { type: "string", enum: ["visit", "scan"] },
          observationId: { type: "string" },
        },
      },

      // ── Role ────────────────────────────────────────────────────
      Role: {
        type: "object",
        properties: {
          title: { type: "string" },
          companyId: { type: "string" },
          companyName: { type: "string" },
          location: { type: "string" },
          description: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          isCurrent: { type: "boolean" },
          seniority: {
            type: "string",
            enum: [
              "Owner",
              "CXO",
              "SVP",
              "VP",
              "Managing Director",
              "Manager",
              "In Training",
              "Individual Contributor",
            ],
          },
          seniorityRank: {
            type: "integer",
            minimum: 1,
            maximum: 8,
          },
        },
      },

      // ── Education ───────────────────────────────────────────────
      Education: {
        type: "object",
        properties: {
          school: { type: "string" },
          degree: { type: "string" },
          field: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
      },

      // ── Person snapshot ─────────────────────────────────────────
      PersonSnapshot: {
        type: "object",
        properties: {
          _id: { type: "string", description: "Primary identifier" },
          canonical_id: {
            type: "string",
            format: "uuid",
            description: "Deterministic UUID v5",
          },
          aliases: {
            type: "array",
            items: { $ref: "#/components/schemas/Alias" },
          },
          snapshot: {
            type: "object",
            properties: {
              firstName: { type: "string" },
              lastName: { type: "string" },
              fullName: { type: "string" },
              currentTitle: { type: "string" },
              currentCompany: { type: "string" },
              currentCompanyId: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              country: { type: "string" },
              industry: { type: "string" },
              connections: { type: "integer" },
              summary: { type: "string" },
              email: { type: "string", format: "email" },
              phone: {
                type: "string",
                description:
                  "Phone number normalized to E.164 format (e.g. +15551234567) via libphonenumber-js",
              },
              twitter: { type: "string" },
              profilePicture: { type: "string", format: "uri" },
              roles: {
                type: "array",
                items: { $ref: "#/components/schemas/Role" },
              },
              education: {
                type: "array",
                items: { $ref: "#/components/schemas/Education" },
              },
              skills: { type: "array", items: { type: "string" } },
              _meta: {
                type: "object",
                additionalProperties: {
                  $ref: "#/components/schemas/ProvenanceEntry",
                },
              },
            },
          },
          observations: {
            type: "object",
            properties: {
              visits: {
                type: "array",
                items: { type: "string" },
              },
              scans: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
          meta: {
            type: "object",
            properties: {
              lastObservedAt: { type: "string", format: "date-time" },
              lastObservation: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  id: { type: "string" },
                  observedAt: { type: "string", format: "date-time" },
                },
              },
              observationsCount: { type: "integer" },
            },
          },
          derived: {
            type: "object",
            properties: {
              avgTenureMonths: { type: "number" },
              yearsAtCurrentCompany: { type: "number" },
              highestSeniority: { type: "string" },
              highestSeniorityRank: { type: "integer" },
              highestSeniorityRoleTitle: { type: "string" },
              highestSeniorityRoleCompany: { type: "string" },
            },
          },
        },
      },

      // ── Company snapshot ────────────────────────────────────────
      CompanySnapshot: {
        type: "object",
        properties: {
          _id: {
            type: "string",
            description: "Numeric LinkedIn company ID",
          },
          canonical_id: { type: "string", format: "uuid" },
          aliases: {
            type: "array",
            items: { $ref: "#/components/schemas/Alias" },
          },
          snapshot: {
            type: "object",
            properties: {
              name: { type: "string" },
              industry: { type: "string" },
              location: { type: "string" },
              description: { type: "string" },
              companyProfileUrl: { type: "string", format: "uri" },
              website: { type: "string", format: "uri" },
              employeeCount: { type: "integer" },
              founded: { type: "string" },
            },
          },
          observations: {
            type: "object",
            properties: {
              visits: { type: "array", items: { type: "string" } },
              scans: { type: "array", items: { type: "string" } },
            },
          },
          meta: {
            type: "object",
            properties: {
              lastObservedAt: { type: "string", format: "date-time" },
              observationsCount: { type: "integer" },
            },
          },
        },
      },

      // ── Location snapshot ───────────────────────────────────────
      LocationSnapshot: {
        type: "object",
        properties: {
          _id: {
            type: "string",
            description: "Normalized location slug",
          },
          canonical_id: { type: "string", format: "uuid" },
          aliases: {
            type: "array",
            items: { $ref: "#/components/schemas/Alias" },
          },
          snapshot: {
            type: "object",
            properties: {
              name: { type: "string" },
              normalized: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              stateCode: { type: "string" },
              country: { type: "string" },
              countryCode: { type: "string" },
              province: { type: "string" },
              region: { type: "string" },
              locationType: { type: "string" },
            },
          },
        },
      },

      // ── Change ──────────────────────────────────────────────────
      Change: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["company_change", "promotion", "title_change"],
          },
          person_id: { type: "string" },
          personSnapshot: {
            type: "object",
            properties: {
              fullName: { type: "string" },
              currentTitle: { type: "string" },
              currentCompany: { type: "string" },
              connections: { type: "integer" },
              city: { type: "string" },
              state: { type: "string" },
              country: { type: "string" },
            },
          },
          from: { type: "string" },
          to: { type: "string" },
          company: { type: "string" },
          tenureDaysAtPreviousRole: { type: "integer" },
          recentJobChange: { type: "boolean" },
          timestamp: { type: "string", format: "date-time" },
          notified: { type: "boolean" },
        },
      },

      // ── Signal ────────────────────────────────────────────────
      Signal: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "new_role",
              "promotion",
              "lateral_move",
              "new_decision_maker",
            ],
          },
          personId: { type: "string" },
          personName: { type: "string", nullable: true },
          title: { type: "string", nullable: true },
          company: { type: "string", nullable: true },
          companyId: { type: "string", nullable: true },
          seniority: { type: "string", nullable: true },
          seniorityRank: { type: "integer", nullable: true },
          score: { type: "number", example: 72.5 },
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          timestamp: { type: "string", format: "date-time" },
          actionContext: { type: "string" },
        },
      },

      // ── Pagination ──────────────────────────────────────────────
      Pagination: {
        type: "object",
        properties: {
          offset: { type: "integer" },
          limit: { type: "integer" },
          count: { type: "integer" },
          totalCount: { type: "integer" },
          hasMore: { type: "boolean" },
          nextSkip: { type: "integer" },
        },
      },

      // ── Error response ─────────────────────────────────────────
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string", example: "VALIDATION_ERROR" },
          message: { type: "string" },
        },
      },

      // ── Rate limit response ─────────────────────────────────────
      RateLimitResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string", example: "RATE_LIMITED" },
          message: {
            type: "string",
            example: "Too many requests, please slow down",
          },
        },
      },
    },

    parameters: {
      limitParam: {
        name: "limit",
        in: "query",
        schema: { type: "integer", default: 20 },
        description: "Maximum results to return",
      },
      skipParam: {
        name: "skip",
        in: "query",
        schema: { type: "integer", default: 0 },
        description: "Number of results to skip (pagination offset)",
      },
    },

    responses: {
      RateLimited: {
        description: "Rate limit exceeded",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RateLimitResponse" },
          },
        },
      },
      NotFound: {
        description: "Resource not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      ServiceUnavailable: {
        description: "Database not ready",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: false },
                error: { type: "string", example: "SERVICE_UNAVAILABLE" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
  },

  // ── Paths ───────────────────────────────────────────────────────
  paths: {
    // ── Webhook ─────────────────────────────────────────────────
    "/api/webhook": {
      post: {
        tags: ["Webhook"],
        summary: "Ingest a DuxSoup webhook event",
        description:
          "Accepts visit or scan events from DuxSoup. Phase 1 writes the observation (must succeed for 200). Phase 2 upserts the person/company snapshot (best-effort).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type", "data"],
                properties: {
                  type: {
                    type: "string",
                    enum: ["visit", "scan"],
                  },
                  data: {
                    type: "object",
                    required: ["id"],
                    properties: {
                      id: { type: "string", description: "DuxSoup profile ID" },
                      userid: { type: "string" },
                      VisitTime: {
                        type: "string",
                        format: "date-time",
                        description: "Visit timestamp (visit type)",
                      },
                      ScanTime: {
                        type: "string",
                        format: "date-time",
                        description: "Scan timestamp (scan type)",
                      },
                      Profile: {
                        type: "string",
                        description: "LinkedIn profile URL",
                      },
                      "First Name": { type: "string" },
                      "Last Name": { type: "string" },
                      Title: { type: "string" },
                      Company: { type: "string" },
                      Location: { type: "string" },
                    },
                  },
                },
              },
              examples: {
                visit: {
                  summary: "Visit event",
                  value: {
                    type: "visit",
                    data: {
                      id: "abc123",
                      userid: "user1",
                      VisitTime: "2025-01-15T10:30:00Z",
                      Profile: "https://www.linkedin.com/in/johndoe",
                      "First Name": "John",
                      "Last Name": "Doe",
                      Title: "VP Engineering",
                      Company: "Acme Corp",
                      Location: "San Francisco, CA",
                      Degree: "1st",
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Webhook processed successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    message: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        duxsoupId: { type: "string" },
                        profile: { type: "string" },
                        status: {
                          type: "string",
                          example: "processed",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "Invalid payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/webhook/batch": {
      post: {
        tags: ["Webhook"],
        summary: "Batch process DuxSoup webhook events",
        description:
          "Accepts an array of webhook payloads (max 50) for batch processing. Each item is processed independently; partial failures are reported in the response.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: {
                  type: "object",
                  required: ["type", "data"],
                  properties: {
                    type: {
                      type: "string",
                      enum: ["visit", "scan"],
                    },
                    data: {
                      type: "object",
                      required: ["id"],
                      properties: {
                        id: { type: "string" },
                      },
                    },
                  },
                },
                maxItems: 50,
              },
            },
          },
        },
        responses: {
          200: {
            description: "Batch processed (individual results in body)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    processed: { type: "integer" },
                    failed: { type: "integer" },
                    results: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          400: {
            description: "Invalid payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── People ──────────────────────────────────────────────────
    "/api/people/{id}": {
      get: {
        tags: ["People"],
        summary: "Get person by ID",
        description:
          "Retrieve a person snapshot by canonical ID or Sales Navigator ID.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Canonical ID or Sales Nav ID",
          },
        ],
        responses: {
          200: {
            description: "Person found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    person: {
                      $ref: "#/components/schemas/PersonSnapshot",
                    },
                  },
                },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    "/api/people/by-alias/{value}": {
      get: {
        tags: ["People"],
        summary: "Get person by alias",
        description:
          "Find a person by any known alias (Sales Nav ID, numeric ID, or profile URL).",
        parameters: [
          {
            name: "value",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Alias value to search for",
          },
        ],
        responses: {
          200: {
            description: "Person found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    person: {
                      $ref: "#/components/schemas/PersonSnapshot",
                    },
                  },
                },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    "/api/people/by-aliases": {
      post: {
        tags: ["People"],
        summary: "Bulk lookup people by alias values",
        description:
          "Look up multiple people by their alias values in a single request.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["values"],
                properties: {
                  values: {
                    type: "array",
                    items: { type: "string" },
                    description: "Alias values to look up",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "People found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/PersonSnapshot",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── Person Timeline ─────────────────────────────────────────
    "/api/people/{id}/timeline": {
      get: {
        tags: ["People"],
        summary: "Get person activity timeline",
        description:
          "Chronological feed of all observed events and changes for a person: visits, scans, job changes, promotions, title changes, and lateral moves.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Person canonical ID, Sales Nav ID, or _id",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 50, maximum: 500 },
            description: "Maximum events to return (default 50, max 500)",
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", default: 0 },
            description: "Pagination offset",
          },
          {
            name: "from",
            in: "query",
            schema: { type: "string", format: "date-time" },
            description: "ISO date lower bound filter",
          },
          {
            name: "to",
            in: "query",
            schema: { type: "string", format: "date-time" },
            description: "ISO date upper bound filter",
          },
        ],
        responses: {
          200: {
            description: "Timeline retrieved",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        personId: { type: "string" },
                        timeline: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              timestamp: {
                                type: "string",
                                format: "date-time",
                              },
                              type: {
                                type: "string",
                                enum: [
                                  "first_seen",
                                  "visit",
                                  "scan",
                                  "company_change",
                                  "promotion",
                                  "title_change",
                                  "lateral_move",
                                ],
                              },
                              source: {
                                type: "object",
                                properties: {
                                  type: { type: "string" },
                                  id: { type: "string" },
                                },
                              },
                              snapshot: {
                                type: "object",
                                properties: {
                                  currentTitle: { type: "string" },
                                  currentCompany: { type: "string" },
                                  location: { type: "string" },
                                },
                              },
                              detail: {
                                type: "object",
                                properties: {
                                  from: { type: "string" },
                                  to: { type: "string" },
                                  tenureDays: { type: "integer" },
                                },
                              },
                            },
                          },
                        },
                        metadata: {
                          type: "object",
                          properties: {
                            totalEvents: { type: "integer" },
                            dateRange: {
                              type: "object",
                              properties: {
                                from: {
                                  type: "string",
                                  format: "date-time",
                                  nullable: true,
                                },
                                to: {
                                  type: "string",
                                  format: "date-time",
                                  nullable: true,
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    total: { type: "integer" },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                  },
                },
              },
            },
          },
          400: { $ref: "#/components/responses/BadRequest" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Companies ───────────────────────────────────────────────
    "/api/companies/{id}": {
      get: {
        tags: ["Companies"],
        summary: "Get company by ID",
        description:
          "Retrieve a company snapshot by numeric LinkedIn company ID.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Numeric LinkedIn company ID",
          },
        ],
        responses: {
          200: {
            description: "Company found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    company: {
                      $ref: "#/components/schemas/CompanySnapshot",
                    },
                  },
                },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    "/api/companies/by-alias/{value}": {
      get: {
        tags: ["Companies"],
        summary: "Get company by alias",
        parameters: [
          {
            name: "value",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Company found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    company: {
                      $ref: "#/components/schemas/CompanySnapshot",
                    },
                  },
                },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Company Intelligence ──────────────────────────────────
    "/api/companies/{id}/intelligence": {
      get: {
        tags: ["Companies"],
        summary: "Company intelligence rollup",
        description:
          "Aggregates all people linked to a company into org-level insights: headcount by seniority and department, decision makers, tenure, hiring velocity, geography, and recent hires/departures.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Numeric LinkedIn company ID",
          },
          {
            name: "fresh",
            in: "query",
            schema: { type: "string", enum: ["true"] },
            description: "Bypass cache and recompute metrics",
          },
        ],
        responses: {
          200: {
            description: "Company intelligence data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        company: {
                          type: "object",
                          properties: {
                            _id: { type: "string" },
                            name: { type: "string" },
                            industry: { type: "string" },
                            location: { type: "string" },
                            website: { type: "string" },
                          },
                        },
                        headcount: {
                          type: "object",
                          properties: {
                            total: { type: "integer" },
                            bySeniority: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  tier: { type: "string" },
                                  count: { type: "integer" },
                                  percentage: { type: "number" },
                                },
                              },
                            },
                            byDepartment: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  department: { type: "string" },
                                  count: { type: "integer" },
                                  percentage: { type: "number" },
                                },
                              },
                            },
                          },
                        },
                        decisionMakers: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              personId: { type: "string" },
                              fullName: { type: "string" },
                              title: { type: "string" },
                              seniority: { type: "string" },
                              email: { type: "string" },
                              city: { type: "string" },
                              lastObservedAt: {
                                type: "string",
                                format: "date-time",
                              },
                            },
                          },
                        },
                        recentHires: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              personId: { type: "string" },
                              fullName: { type: "string" },
                              title: { type: "string" },
                              from: { type: "string" },
                              seniority: { type: "string" },
                              timestamp: {
                                type: "string",
                                format: "date-time",
                              },
                            },
                          },
                        },
                        recentDepartures: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              personId: { type: "string" },
                              fullName: { type: "string" },
                              title: { type: "string" },
                              to: { type: "string" },
                              seniority: { type: "string" },
                              timestamp: {
                                type: "string",
                                format: "date-time",
                              },
                            },
                          },
                        },
                        tenure: {
                          type: "object",
                          properties: {
                            avgYears: { type: "number", nullable: true },
                            medianYears: { type: "number", nullable: true },
                            withData: { type: "integer" },
                          },
                        },
                        hiringVelocity: {
                          type: "object",
                          properties: {
                            monthlyNewPeople: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  year: { type: "integer" },
                                  month: { type: "integer" },
                                  count: { type: "integer" },
                                },
                              },
                            },
                            avgPerMonth: { type: "number" },
                            trend: {
                              type: "string",
                              enum: ["increasing", "decreasing", "stable"],
                            },
                          },
                        },
                        geography: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              city: { type: "string" },
                              country: { type: "string" },
                              count: { type: "integer" },
                            },
                          },
                        },
                      },
                    },
                    metadata: {
                      type: "object",
                      properties: {
                        companyId: { type: "string" },
                        generatedAt: {
                          type: "string",
                          format: "date-time",
                        },
                        cached: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "Invalid company ID",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── Locations ───────────────────────────────────────────────
    "/api/locations/{id}": {
      get: {
        tags: ["Locations"],
        summary: "Get location by ID",
        description: "Retrieve a location snapshot by normalized slug.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Normalized location slug (e.g. san-francisco-ca)",
          },
        ],
        responses: {
          200: {
            description: "Location found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    location: {
                      $ref: "#/components/schemas/LocationSnapshot",
                    },
                  },
                },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    "/api/locations/by-alias/{value}": {
      get: {
        tags: ["Locations"],
        summary: "Get location by alias",
        parameters: [
          {
            name: "value",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Location found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    location: {
                      $ref: "#/components/schemas/LocationSnapshot",
                    },
                  },
                },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Query ───────────────────────────────────────────────────
    "/api/query/people": {
      post: {
        tags: ["Query"],
        summary: "Query people with filters",
        description:
          "Filter people using MongoDB-style query operators. Supports sorting, pagination, and field selection.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  filters: {
                    type: "object",
                    description:
                      "MongoDB query filters (e.g. snapshot.currentTitle, snapshot.city)",
                    example: {
                      "snapshot.currentCompany": "Google",
                    },
                  },
                  sort: {
                    type: "object",
                    description: "Sort fields and direction (1 asc, -1 desc)",
                    example: { "snapshot.connections": -1 },
                  },
                  limit: {
                    type: "integer",
                    default: 20,
                    maximum: 500,
                  },
                  skip: { type: "integer", default: 0 },
                  fields: {
                    type: "array",
                    items: { type: "string" },
                    description: "Fields to include in response",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Query results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/PersonSnapshot",
                      },
                    },
                    pagination: {
                      $ref: "#/components/schemas/Pagination",
                    },
                  },
                },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/query/companies": {
      post: {
        tags: ["Query"],
        summary: "Query companies with filters",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  filters: { type: "object" },
                  sort: { type: "object" },
                  limit: {
                    type: "integer",
                    default: 20,
                    maximum: 500,
                  },
                  skip: { type: "integer", default: 0 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Query results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/CompanySnapshot",
                      },
                    },
                    pagination: {
                      $ref: "#/components/schemas/Pagination",
                    },
                  },
                },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/query/help": {
      get: {
        tags: ["Query"],
        summary: "Query API usage help",
        responses: {
          200: { description: "Help documentation" },
        },
      },
    },

    // ── Search ──────────────────────────────────────────────────
    "/api/search": {
      get: {
        tags: ["Search"],
        summary: "Full-text search people",
        description:
          "Search people by name, title, or company using MongoDB text index. Weighted: fullName (10), currentTitle (5), currentCompany (3).",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 2 },
            description: "Search query (min 2 characters)",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20, maximum: 100 },
          },
          {
            name: "skip",
            in: "query",
            schema: { type: "integer", default: 0 },
          },
          {
            name: "fields",
            in: "query",
            schema: { type: "string" },
            description: "Comma-separated list of fields to include",
          },
        ],
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/PersonSnapshot",
                      },
                    },
                    pagination: {
                      $ref: "#/components/schemas/Pagination",
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "Missing or invalid query",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── Export ───────────────────────────────────────────────────
    "/api/export/people/csv": {
      post: {
        tags: ["Export"],
        summary: "Export people to CSV",
        description:
          "Create an async export job. Poll the returned statusUrl for progress.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  filters: {
                    type: "object",
                    description: "MongoDB query filters",
                  },
                  fields: {
                    type: "array",
                    items: { type: "string" },
                    example: ["firstName", "lastName", "currentTitle", "email"],
                  },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: "Export job created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        jobId: { type: "string", format: "uuid" },
                        status: {
                          type: "string",
                          example: "pending",
                        },
                        statusUrl: { type: "string" },
                        message: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/export/people/json": {
      post: {
        tags: ["Export"],
        summary: "Export people to JSON",
        description: "Same as CSV export but produces JSON format.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  filters: { type: "object" },
                  fields: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: {
          202: { description: "Export job created" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/export/companies/csv": {
      post: {
        tags: ["Export"],
        summary: "Export companies to CSV",
        description:
          "Create an async export job for company data in CSV format.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  filters: { type: "object" },
                  fields: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: {
          202: { description: "Export job created" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/export/companies/json": {
      post: {
        tags: ["Export"],
        summary: "Export companies to JSON",
        description:
          "Create an async export job for company data in JSON format.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  filters: { type: "object" },
                  fields: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: {
          202: { description: "Export job created" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/export/locations/csv": {
      post: {
        tags: ["Export"],
        summary: "Export locations to CSV",
        description:
          "Create an async export job for location data in CSV format.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  filters: { type: "object" },
                  fields: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: {
          202: { description: "Export job created" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/export/locations/json": {
      post: {
        tags: ["Export"],
        summary: "Export locations to JSON",
        description:
          "Create an async export job for location data in JSON format.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  filters: { type: "object" },
                  fields: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: {
          202: { description: "Export job created" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/export/status/{jobId}": {
      get: {
        tags: ["Export"],
        summary: "Check export job status",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          200: {
            description: "Job status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        jobId: { type: "string" },
                        status: {
                          type: "string",
                          enum: [
                            "pending",
                            "processing",
                            "completed",
                            "failed",
                          ],
                        },
                        result: {
                          type: "object",
                          properties: {
                            filePath: { type: "string" },
                            fileSize: { type: "integer" },
                            rowCount: { type: "integer" },
                            downloadUrl: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    "/api/export/download/{jobId}": {
      get: {
        tags: ["Export"],
        summary: "Download export file",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          200: {
            description: "File download",
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          400: {
            description: "Export not ready or failed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Changes ─────────────────────────────────────────────────
    "/api/changes": {
      get: {
        tags: ["Changes"],
        summary: "List recent job changes",
        description:
          "List detected job changes, promotions, and title changes across tracked people.",
        parameters: [
          {
            name: "type",
            in: "query",
            schema: {
              type: "string",
              enum: ["company_change", "promotion", "title_change"],
            },
            description: "Filter by change type",
          },
          {
            name: "days",
            in: "query",
            schema: { type: "integer", default: 30 },
            description: "Lookback period in days",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 100, maximum: 1000 },
          },
        ],
        responses: {
          200: {
            description: "Changes list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        changes: {
                          type: "array",
                          items: {
                            $ref: "#/components/schemas/Change",
                          },
                        },
                        metadata: {
                          type: "object",
                          properties: {
                            count: { type: "integer" },
                            type: { type: "string" },
                            days: { type: "integer" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/changes/person/{id}": {
      get: {
        tags: ["Changes"],
        summary: "Get changes for a specific person",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Person ID",
          },
        ],
        responses: {
          200: {
            description: "Person changes",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        changes: {
                          type: "array",
                          items: {
                            $ref: "#/components/schemas/Change",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── Seniority ───────────────────────────────────────────────
    "/api/seniority/tiers": {
      get: {
        tags: ["Seniority"],
        summary: "List all seniority tiers",
        responses: {
          200: {
            description: "Seniority tier definitions",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          tier: { type: "string" },
                          rank: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    "/api/seniority/distribution": {
      get: {
        tags: ["Seniority"],
        summary: "Seniority distribution",
        parameters: [
          {
            name: "groupBy",
            in: "query",
            schema: {
              type: "string",
              enum: ["highest", "all"],
              default: "highest",
            },
          },
        ],
        responses: {
          200: {
            description: "Distribution data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        distribution: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              tier: { type: "string" },
                              count: { type: "integer" },
                              percentage: { type: "number" },
                              avgRank: { type: "number" },
                            },
                          },
                        },
                        total: { type: "integer" },
                        groupBy: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    "/api/seniority/filter": {
      get: {
        tags: ["Seniority"],
        summary: "Filter people by seniority",
        parameters: [
          {
            name: "tier",
            in: "query",
            schema: { type: "string" },
            description: "Seniority tier (e.g. VP, CXO)",
          },
          {
            name: "minRank",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 8 },
          },
          {
            name: "maxRank",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 8 },
          },
          {
            name: "department",
            in: "query",
            schema: { type: "string" },
            description: "Search within titles",
          },
          {
            name: "company",
            in: "query",
            schema: { type: "string" },
            description: "Filter by company name",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 50, maximum: 500 },
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", default: 0 },
          },
          {
            name: "sortBy",
            in: "query",
            schema: {
              type: "string",
              enum: ["rank", "name", "company"],
              default: "rank",
            },
          },
          {
            name: "sortOrder",
            in: "query",
            schema: {
              type: "string",
              enum: ["asc", "desc"],
              default: "desc",
            },
          },
        ],
        responses: {
          200: {
            description: "Filtered results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        people: {
                          type: "array",
                          items: {
                            $ref: "#/components/schemas/PersonSnapshot",
                          },
                        },
                        total: { type: "integer" },
                        limit: { type: "integer" },
                        offset: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    "/api/seniority/search": {
      get: {
        tags: ["Seniority"],
        summary: "Search people with seniority filters",
        parameters: [
          {
            name: "q",
            in: "query",
            schema: { type: "string" },
            description: "Search query",
          },
          {
            name: "tier",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "minRank",
            in: "query",
            schema: { type: "integer" },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20 },
          },
        ],
        responses: {
          200: { description: "Search results" },
        },
      },
    },

    "/api/seniority/stats": {
      get: {
        tags: ["Seniority"],
        summary: "Seniority statistics",
        description:
          "Aggregate statistics including distribution by highest role, all roles, and top companies with senior leaders.",
        responses: {
          200: {
            description: "Seniority statistics",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        byHighestRole: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              _id: { type: "string" },
                              count: { type: "integer" },
                            },
                          },
                        },
                        byAllRoles: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              _id: { type: "string" },
                              count: { type: "integer" },
                            },
                          },
                        },
                        topCompaniesWithSeniorLeaders: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              _id: { type: "string" },
                              count: { type: "integer" },
                              avgRank: { type: "number" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── Signals ──────────────────────────────────────────────────
    "/api/signals": {
      get: {
        tags: ["Signals"],
        summary: "Engagement trigger feed",
        description:
          "Ranked, deduplicated engagement signals with action context. Surfaces new roles, promotions, lateral moves, and newly observed decision-makers.",
        parameters: [
          {
            name: "type",
            in: "query",
            schema: { type: "string" },
            description:
              "Comma-separated signal types: new_role, promotion, lateral_move, new_decision_maker",
          },
          {
            name: "minRank",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 8 },
            description: "Minimum seniority rank (1-8)",
          },
          {
            name: "company",
            in: "query",
            schema: { type: "string" },
            description: "Company name filter (regex)",
          },
          {
            name: "companyId",
            in: "query",
            schema: { type: "string" },
            description: "Company ID filter",
          },
          {
            name: "days",
            in: "query",
            schema: { type: "integer", default: 30, maximum: 180 },
            description: "Lookback window in days (default 30, max 180)",
          },
          { $ref: "#/components/parameters/limitParam" },
          { $ref: "#/components/parameters/offsetParam" },
          {
            name: "fresh",
            in: "query",
            schema: { type: "string", enum: ["true"] },
            description: "Bypass cache and recompute signals",
          },
        ],
        responses: {
          200: {
            description: "Engagement signals",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Signal" },
                    },
                    total: { type: "integer" },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                    metadata: {
                      type: "object",
                      properties: {
                        types: {
                          type: "array",
                          items: { type: "string" },
                        },
                        minRank: { type: "integer" },
                        days: { type: "integer" },
                        generatedAt: {
                          type: "string",
                          format: "date-time",
                        },
                        cached: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "Invalid signal type",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── Health ───────────────────────────────────────────────────
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Basic health check",
        description:
          "Always returns 200 for container orchestration. Database readiness is reported in the body.",
        responses: {
          200: {
            description: "Server is running",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["ok", "starting"],
                    },
                    database: { type: "object" },
                    timestamp: {
                      type: "string",
                      format: "date-time",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    "/api/health/ingestion": {
      get: {
        tags: ["Health"],
        summary: "Ingestion health metrics",
        description:
          "24-hour ingestion statistics including success rates, failure counts, and dead letter status.",
        responses: {
          200: {
            description: "Ingestion health",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["healthy", "degraded", "unhealthy"],
                    },
                    metrics: {
                      type: "object",
                      properties: {
                        people_upsert_success_rate_24h: {
                          type: "number",
                        },
                        total_observations_24h: { type: "integer" },
                        dead_letters_pending: { type: "integer" },
                      },
                    },
                    alerts: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          level: {
                            type: "string",
                            enum: ["warning", "critical"],
                          },
                          message: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/parity": {
      get: {
        tags: ["Health"],
        summary: "Visit/Scan parity check",
        responses: {
          200: { description: "Parity comparison" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/metrics": {
      get: {
        tags: ["Health"],
        summary: "Overall system metrics",
        responses: {
          200: { description: "System metrics" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/dashboard": {
      get: {
        tags: ["Health"],
        summary: "Comprehensive monitoring dashboard",
        responses: {
          200: { description: "All metrics combined" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/data-cleanliness": {
      get: {
        tags: ["Health"],
        summary: "Data cleanliness metrics",
        description:
          "Field-level cleanliness: whitespace issues, invalid emails, duplicate skills/education, missing key fields.",
        parameters: [
          {
            name: "fresh",
            in: "query",
            schema: { type: "string", enum: ["true"] },
            description: "Bypass cache and recompute metrics",
          },
        ],
        responses: {
          200: {
            description: "Data cleanliness report",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        totalPeople: { type: "integer", example: 12345 },
                        whitespace: { type: "object" },
                        email: { type: "object" },
                        skills: { type: "object" },
                        education: { type: "object" },
                        phone: {
                          type: "object",
                          properties: {
                            totalWithPhone: { type: "integer" },
                            notE164Format: { type: "integer" },
                            percentage: { type: "number" },
                          },
                        },
                        missingFields: { type: "object" },
                        timestamp: {
                          type: "string",
                          format: "date-time",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/data-quality": {
      get: {
        tags: ["Health"],
        summary: "Data quality metrics",
        responses: {
          200: { description: "Data quality audit" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/quality": {
      get: {
        tags: ["Health"],
        summary: "Structural data quality dashboard",
        description:
          "Identity resolution gaps, alias coverage, enrichment depth, and freshness buckets.",
        parameters: [
          {
            name: "fresh",
            in: "query",
            schema: { type: "string", enum: ["true"] },
            description: "Bypass cache and recompute metrics",
          },
        ],
        responses: {
          200: {
            description: "Data quality report",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        totalPeople: {
                          type: "integer",
                          example: 12345,
                        },
                        identity: { type: "object" },
                        aliases: { type: "object" },
                        enrichment: { type: "object" },
                        freshness: { type: "object" },
                        timestamp: {
                          type: "string",
                          format: "date-time",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/coverage-breakdown": {
      get: {
        tags: ["Health"],
        summary: "Data coverage breakdown",
        responses: {
          200: { description: "Coverage distribution" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/canonical-coverage": {
      get: {
        tags: ["Health"],
        summary: "Canonical ID coverage",
        responses: {
          200: { description: "Canonical ID statistics" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/company-coverage": {
      get: {
        tags: ["Health"],
        summary: "Company snapshot coverage",
        responses: {
          200: { description: "Company coverage statistics" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/location-coverage": {
      get: {
        tags: ["Health"],
        summary: "Location snapshot coverage",
        responses: {
          200: { description: "Location coverage statistics" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/throughput": {
      get: {
        tags: ["Health"],
        summary: "Real-time webhook throughput metrics",
        description:
          "Throughput metrics across 1m, 5m, 15m, and 1h sliding windows.",
        responses: {
          200: { description: "Throughput metrics" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/health/test-notifications": {
      get: {
        tags: ["Health"],
        summary: "Test notification configuration",
        description:
          "Verify that email/SMS notification configuration is valid. Requires authorization.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Notification configuration status" },
          401: { description: "Unauthorized" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── Admin ───────────────────────────────────────────────────
    "/api/admin/health": {
      get: {
        tags: ["Admin"],
        summary: "Admin endpoint health check",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Admin endpoints available",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    available_endpoints: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/api/admin/test-notifications": {
      post: {
        tags: ["Admin"],
        summary: "Test email/SMS notification delivery",
        description:
          "Send a test notification to verify email and SMS delivery configuration.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Test notification sent" },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/api/admin/check-upgradable": {
      get: {
        tags: ["Admin"],
        summary: "Check upgradable URL-fallback people",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Upgradable people stats",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url_fallback_total: { type: "integer" },
                    upgradable_count: { type: "integer" },
                    percent_upgradable: { type: "number" },
                    recommendation: { type: "string" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/api/admin/run-linking": {
      post: {
        tags: ["Admin"],
        summary: "Run identity linking job",
        description:
          "Merge URL-fallback people with their stable-ID counterparts. Defaults to dry-run mode.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  limit: {
                    type: "integer",
                    default: 100,
                    maximum: 1000,
                  },
                  batchSize: { type: "integer", default: 10 },
                  dryRun: { type: "boolean", default: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Linking job results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    stats: {
                      type: "object",
                      properties: {
                        found: { type: "integer" },
                        merged: { type: "integer" },
                        skipped: { type: "integer" },
                        failed: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/api/admin/rebuild-people": {
      post: {
        tags: ["Admin"],
        summary: "Rebuild people from observations (limited)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  limit: {
                    type: "integer",
                    default: 1000,
                    maximum: 5000,
                  },
                  source: {
                    type: "string",
                    enum: ["visit", "scan", "both"],
                    default: "both",
                  },
                  dryRun: { type: "boolean", default: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Rebuild results" },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/api/admin/rebuild-people-full": {
      post: {
        tags: ["Admin"],
        summary: "Rebuild people from ALL observations",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  source: {
                    type: "string",
                    enum: ["visit", "scan", "both"],
                    default: "both",
                  },
                  dryRun: { type: "boolean", default: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Full rebuild results" },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/api/admin/fix-alias-types": {
      post: {
        tags: ["Admin"],
        summary: "Fix invalid alias types",
        description:
          "Convert old profileUrl alias types to salesUrl or publicUrl.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Fix results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    message: { type: "string" },
                    fixed_count: { type: "integer" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/api/admin/inspect-observations": {
      get: {
        tags: ["Admin"],
        summary: "Inspect observation data structures",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Observation inspection results" },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/api/admin/drop-id-index": {
      delete: {
        tags: ["Admin"],
        summary: "Drop legacy duplicate ID indexes",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Index migration results" },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/api/admin/replay/{observationId}": {
      post: {
        tags: ["Admin"],
        summary: "Replay a failed observation",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "observationId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Dead-letter observation ID to replay",
          },
        ],
        responses: {
          200: { description: "Observation replayed" },
          401: { description: "Unauthorized" },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
  },
};

module.exports = spec;
