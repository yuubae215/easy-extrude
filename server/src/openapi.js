/**
 * OpenAPI 3.0 specification for the easy-extrude BFF.
 *
 * Served as Swagger UI at GET /api/docs
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'easy-extrude BFF',
    version: '1.0.0',
    description: [
      'Backend for Frontend for the easy-extrude voxel 3D modelling app.',
      '',
      '**Authentication (Phase A — dev mode)**',
      '1. Call `GET /api/auth/token` to get a dev JWT (no credentials needed).',
      '2. Click **Authorize** and enter `Bearer <token>`.',
      '3. When `BFF_REQUIRE_AUTH` is not set, all protected routes also accept',
      '   unauthenticated requests (treated as `anonymous/dev`).',
    ].join('\n'),
  },
  servers: [{ url: '/api', description: 'BFF (this server)' }],

  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      SceneMeta: {
        type: 'object',
        properties: {
          id:         { type: 'string', example: 'scene_a1b2c3d4e5f6g7h8' },
          name:       { type: 'string', example: 'My Scene' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      TransformGraph: {
        type: 'object',
        properties: {
          nodes: { type: 'array', items: { type: 'object' } },
          edges: { type: 'array', items: { type: 'object' } },
        },
      },
      SceneData: {
        type: 'object',
        properties: {
          objects:        { type: 'array', items: { type: 'object' } },
          transformGraph: { $ref: '#/components/schemas/TransformGraph' },
        },
      },
      Scene: {
        allOf: [
          { $ref: '#/components/schemas/SceneMeta' },
          {
            type: 'object',
            properties: {
              data: { $ref: '#/components/schemas/SceneData' },
            },
          },
        ],
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Scene not found' },
        },
      },

      // ── Layout DSL ──────────────────────────────────────────────────────
      LayoutDimensions: {
        type: 'object',
        description: 'Solid dimensions in mm (body-frame, axis-aligned)',
        required: ['x', 'y', 'z'],
        properties: {
          x: { type: 'number', example: 500, description: 'Width (+X forward, ROS REP-103)' },
          y: { type: 'number', example: 300, description: 'Depth (+Y left)' },
          z: { type: 'number', example: 800, description: 'Height (+Z up)' },
        },
      },
      LayoutPosition: {
        type: 'object',
        description: 'World-space centroid in mm (ADR-040 _position). For a Solid of height h, bottom is at z = position.z - h/2.',
        required: ['x', 'y', 'z'],
        properties: {
          x: { type: 'number', example: 2800 },
          y: { type: 'number', example: 0 },
          z: { type: 'number', example: 400 },
        },
      },
      LayoutFrame: {
        type: 'object',
        description: 'Child CoordinateFrame attached to a Solid (parent is always the Solid\'s Origin CF — ADR-037)',
        required: ['ref', 'name'],
        properties: {
          ref:         { type: 'string', example: 'robot_mount', description: 'Unique ref used in constraints' },
          name:        { type: 'string', example: 'ロボット取付点' },
          translation: { $ref: '#/components/schemas/LayoutPosition' },
          rotation:    {
            type: 'object',
            description: 'Quaternion (default: identity)',
            properties: {
              x: { type: 'number', default: 0 },
              y: { type: 'number', default: 0 },
              z: { type: 'number', default: 0 },
              w: { type: 'number', default: 1 },
            },
          },
        },
      },
      LayoutEntity: {
        type: 'object',
        required: ['ref', 'type', 'name'],
        properties: {
          ref:         { type: 'string', example: 'workbench', description: 'Unique identifier within this DSL. Used in constraints as source/target.' },
          type:        { type: 'string', enum: ['Solid', 'CoordinateFrame', 'AnnotatedLine', 'AnnotatedRegion', 'AnnotatedPoint'] },
          name:        { type: 'string', example: '作業台' },
          description: { type: 'string' },
          ifcClass:    { type: 'string', example: 'IfcFurniture', description: 'IFC4 semantic class' },
          dimensions:  { $ref: '#/components/schemas/LayoutDimensions', description: 'Required for Solid' },
          position:    { $ref: '#/components/schemas/LayoutPosition',   description: 'Overrides strategy. Required for AnnotatedPoint in manual strategy.' },
          vertices: {
            type: 'array',
            description: 'Required for AnnotatedLine / AnnotatedRegion',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                z: { type: 'number', default: 0 },
              },
            },
          },
          placeType: { type: 'string', enum: ['Zone', 'Route', 'Hub', 'Anchor'], description: 'For Annotated* entities' },
          frames: {
            type: 'array',
            description: 'Child CoordinateFrames (Solid only)',
            items: { $ref: '#/components/schemas/LayoutFrame' },
          },
        },
      },
      LayoutConstraint: {
        type: 'object',
        required: ['source', 'target', 'semanticType'],
        description: [
          'A directed semantic edge between two entities (SpatialLink — ADR-038).',
          '',
          '**source/target ref forms:**',
          '- `"<ref>"` — the entity itself',
          '- `"<ref>_origin"` — auto-generated Origin CF of a Solid (ADR-037)',
          '- `"<frame.ref>"` — a user-defined CoordinateFrame on a Solid',
        ].join('\n'),
        properties: {
          source: { type: 'string', example: 'robot_base' },
          target: { type: 'string', example: 'robot_mount' },
          jointType: {
            type: 'string',
            nullable: true,
            enum: ['fixed', 'revolute', 'continuous', 'prismatic', 'floating', 'planar', null],
            description: 'URDF kinematic type. Use "fixed" for rigid bolted connections. null = semantic-only (no constraint solver).',
            example: 'fixed',
          },
          semanticType: {
            type: 'string',
            enum: ['fastened', 'mounts', 'aligned', 'contains', 'adjacent', 'above', 'connects', 'references', 'represents', 'bounded_by'],
            description: 'Domain semantic annotation.',
            example: 'fastened',
          },
          properties: { type: 'object', description: 'Arbitrary metadata (clearance, cable spec, etc.)', additionalProperties: true },
        },
      },
      LayoutDSL: {
        type: 'object',
        required: ['version', 'entities'],
        description: 'Layout DSL v1.0 — declarative 5W1H scene composition request (ADR-045)',
        properties: {
          version:  { type: 'string', enum: ['layout/1.0'], example: 'layout/1.0' },
          meta: {
            type: 'object',
            properties: {
              name:        { type: 'string', example: '工場セル自動化レイアウト' },
              description: { type: 'string' },
            },
          },
          strategy: {
            type: 'string',
            enum: ['linear', 'grid', 'stack', 'radial', 'manual'],
            default: 'manual',
            description: [
              'Placement algorithm for entities without an explicit `position`:',
              '- `manual`: position required on every entity',
              '- `linear`: axis + spacing (default +X, 3000mm)',
              '- `grid`: cols × rows on XY plane',
              '- `stack`: stacked along +Z',
              '- `radial`: circular arrangement',
            ].join('\n'),
          },
          strategyOptions: {
            type: 'object',
            properties: {
              axis:    { type: 'string', enum: ['+X', '-X', '+Y', '-Y', '+Z', '-Z'], default: '+X' },
              spacing: { type: 'number', default: 3000, description: 'Gap between entity centers in mm' },
              cols:    { type: 'integer', default: 3,    description: 'Columns for grid strategy' },
              baseZ:   { type: 'number', default: 0,     description: 'Starting Z for stack strategy' },
            },
          },
          entities:    { type: 'array', items: { $ref: '#/components/schemas/LayoutEntity' }, minItems: 1 },
          constraints: { type: 'array', items: { $ref: '#/components/schemas/LayoutConstraint' } },
        },
      },
      LayoutCompileRequest: {
        type: 'object',
        required: ['dsl'],
        properties: {
          dsl: { $ref: '#/components/schemas/LayoutDSL' },
        },
      },
      LayoutSaveRequest: {
        type: 'object',
        required: ['name', 'dsl'],
        properties: {
          name: { type: 'string', example: '工場セル自動化' },
          dsl:  { $ref: '#/components/schemas/LayoutDSL' },
        },
      },
      SceneV13: {
        type: 'object',
        description: 'SceneSerializer v1.3 JSON — compatible with SceneImporter.parseImportJson()',
        properties: {
          version:        { type: 'string', example: '1.3' },
          objects:        { type: 'array', items: { type: 'object' }, description: 'Solid / CoordinateFrame / Annotated* DTOs' },
          links:          { type: 'array', items: { type: 'object' }, description: 'SpatialLink DTOs' },
          transformGraph: { $ref: '#/components/schemas/TransformGraph' },
        },
      },
      LayoutError: {
        type: 'object',
        properties: {
          error:   { type: 'string', example: 'Layout DSL compilation failed' },
          details: { type: 'array', items: { type: 'string' }, example: ['entities[0].dimensions must have positive x, y, z numbers'] },
        },
      },

      // ── Grasp search (delegated to external grasp-search service) ─────────
      // Shapes are owned by @easy-extrude/grasp-contract (the neutral JSON
      // Schema). These docs mirror that contract; they do not define it.
      GraspSearchRequest: {
        type: 'object',
        description: 'BFF -> grasp-search input. Contract: @easy-extrude/grasp-contract (wire/camelCase).',
        required: ['layoutVersion', 'graspSearch'],
        properties: {
          contractVersion: { type: 'integer', example: 1, description: 'Optional; if present it must match the canonical contractVersion or the BFF returns 400.' },
          layoutVersion:   { type: 'string', example: 'layout/1.0', description: 'Layout DSL schema version this declaration targets (references the public schema; not redefined).' },
          graspSearch: {
            type: 'object',
            description: 'graspSearch declaration. Detailed shape owned by the Layout DSL schema named by layoutVersion; intentionally open here.',
            additionalProperties: true,
            properties: {
              objectiveWeights: { type: 'object', additionalProperties: { type: 'number' }, description: 'objective name -> weight' },
              topN:             { type: 'integer', minimum: 1, default: 5 },
            },
          },
        },
      },
      GraspSearchResponse: {
        type: 'object',
        description: 'grasp-search -> BFF output. Top-N ranking with score breakdown.',
        required: ['candidates'],
        properties: {
          contractVersion: { type: 'integer', example: 1 },
          candidates: {
            type: 'array',
            description: 'Ranked candidates, rank ascending (1 = best).',
            items: {
              type: 'object',
              required: ['rank', 'score'],
              properties: {
                rank: { type: 'integer', minimum: 1 },
                pose: { type: 'object', additionalProperties: true, description: 'Opaque at the contract boundary; shape owned by the service.' },
                score: {
                  type: 'object',
                  required: ['withinReach', 'ikSolvable', 'interferenceFree', 'totalScore'],
                  properties: {
                    withinReach:      { type: 'boolean' },
                    ikSolvable:       { type: 'boolean' },
                    interferenceFree: { type: 'boolean' },
                    objectiveScores:  { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 } },
                    totalScore:       { type: 'number', minimum: 0 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  security: [{ BearerAuth: [] }],

  paths: {
    // ── Auth ──────────────────────────────────────────────────────────────
    '/auth/token': {
      get: {
        tags: ['Auth'],
        summary: 'Get a dev JWT (Phase A — no credentials required)',
        security: [],
        responses: {
          200: {
            description: 'Signed JWT valid for 7 days',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── Health ────────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: {
          200: {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status:    { type: 'string', example: 'ok' },
                    phase:     { type: 'string', example: 'B' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── Scenes ────────────────────────────────────────────────────────────
    '/scenes': {
      get: {
        tags: ['Scenes'],
        summary: 'List all scenes (metadata only)',
        responses: {
          200: {
            description: 'Array of scene metadata',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SceneMeta' },
                },
              },
            },
          },
          401: { description: 'Unauthorised', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        tags: ['Scenes'],
        summary: 'Create a new scene',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'data'],
                properties: {
                  name: { type: 'string', example: 'My Scene' },
                  data: { $ref: '#/components/schemas/SceneData' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Scene created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Scene' } } },
          },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Unauthorised', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/scenes/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'scene_a1b2c3d4e5f6g7h8' },
      ],
      get: {
        tags: ['Scenes'],
        summary: 'Get a scene (full data)',
        responses: {
          200: { description: 'Scene found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Scene' } } } },
          404: { description: 'Not found',   content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Unauthorised', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      put: {
        tags: ['Scenes'],
        summary: 'Update a scene (partial patch — name and/or data)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Renamed Scene' },
                  data: { $ref: '#/components/schemas/SceneData' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated scene', content: { 'application/json': { schema: { $ref: '#/components/schemas/Scene' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Not found',        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Unauthorised',      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['Scenes'],
        summary: 'Delete a scene',
        responses: {
          204: { description: 'Deleted (no body)' },
          404: { description: 'Not found',   content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Unauthorised', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ── Layout ───────────────────────────────────────────────────────────
    '/layout/compile': {
      post: {
        tags: ['Layout'],
        summary: 'Compile Layout DSL → SceneSerializer v1.3 JSON (stateless)',
        description: [
          'Pure compilation: no DB write. Returns a scene JSON compatible with',
          '`SceneImporter.parseImportJson()` and `SceneService.importFromJson()`.',
          '',
          '**Layout DSL v1.0** encodes a 5W1H scene composition request (ADR-044/045):',
          '- **Why** → `constraints` (semanticType: fastened / above / connects / …)',
          '- **How** → `strategy` + `strategyOptions` (linear / grid / stack / radial / manual)',
          '- **What** → `entities` (Solid dimensions, CF offsets, annotation vertices)',
          '',
          '`position` is the ADR-040 centroid. For a Solid with height h,',
          'set `position.z = h/2` to place the bottom on the floor (z=0).',
          '',
          'Each Solid automatically gains an Origin CoordinateFrame (ADR-037).',
          'Reference it in constraints as `"<ref>_origin"`.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LayoutCompileRequest' },
              example: {
                dsl: {
                  version: 'layout/1.0',
                  meta: { name: 'Example' },
                  strategy: 'linear',
                  strategyOptions: { axis: '+X', spacing: 3000 },
                  entities: [
                    { ref: 'box_a', type: 'Solid', name: 'Box A', dimensions: { x: 500, y: 500, z: 500 } },
                    { ref: 'box_b', type: 'Solid', name: 'Box B', dimensions: { x: 500, y: 500, z: 500 } },
                  ],
                  constraints: [
                    { source: 'box_a', target: 'box_b', jointType: null, semanticType: 'adjacent' },
                  ],
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'SceneSerializer v1.3 JSON — pass directly to importFromJson()',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SceneV13' },
              },
            },
          },
          400: {
            description: 'Layout DSL validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LayoutError' },
              },
            },
          },
          401: { description: 'Unauthorised', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/layout/scenes': {
      post: {
        tags: ['Layout'],
        summary: 'Compile Layout DSL and persist as a new scene in DB',
        description: 'Equivalent to `POST /layout/compile` followed by `POST /scenes`. Returns the created scene record.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LayoutSaveRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Scene created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Scene' } } },
          },
          400: {
            description: 'Layout DSL validation error or missing fields',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LayoutError' } } },
          },
          401: { description: 'Unauthorised', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ── Grasp search ────────────────────────────────────────────────────────
    '/grasp/search': {
      post: {
        tags: ['Grasp'],
        summary: 'Delegate a grasp-search request to the external grasp-search service',
        description: [
          'The BFF validates the request against the neutral contract',
          '(@easy-extrude/grasp-contract), forwards it to the external',
          'grasp-search service, then validates the response against the contract',
          'before returning it.',
          '',
          '**Scope boundary**: constraint solving (IK / collision / reach / ranking)',
          'is performed by the external service, not here. The BFF derives its',
          'checks from the schema and never defines/extends the contract.',
          '',
          '**Drift detection (both ends)**: a present-but-mismatched',
          '`contractVersion` on the request is rejected with 400; a mismatched',
          'version or non-conforming payload from the upstream service is a 502.',
          'Configure the upstream with the `GRASP_SEARCH_URL` env var.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GraspSearchRequest' },
              example: {
                layoutVersion: 'layout/1.0',
                graspSearch: { objectiveWeights: { reach: 0.6, clearance: 0.4 }, topN: 5 },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Ranked candidates from the grasp-search service',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GraspSearchResponse' } } },
          },
          400: { description: 'Request fails contract validation or version mismatch', content: { 'application/json': { schema: { $ref: '#/components/schemas/LayoutError' } } } },
          401: { description: 'Unauthorised', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          502: { description: 'Upstream returned a non-conforming or version-mismatched response', content: { 'application/json': { schema: { $ref: '#/components/schemas/LayoutError' } } } },
          503: { description: 'grasp-search service unreachable / timed out', content: { 'application/json': { schema: { $ref: '#/components/schemas/LayoutError' } } } },
        },
      },
    },

    // ── Import ────────────────────────────────────────────────────────────
    '/import/step': {
      post: {
        tags: ['Import'],
        summary: 'Upload and parse a STEP file',
        description: [
          'Parses the STEP file in a worker thread and returns the triangulated mesh.',
          'Optionally sends `import.progress` events via WebSocket when `sessionId` is provided.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file:      { type: 'string', format: 'binary', description: 'STEP file (max 500 MB)' },
                  scale:     { type: 'number', default: 1, description: 'Unit scale factor' },
                  sessionId: { type: 'string', description: 'WS session ID for progress notifications' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Parsed mesh data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jobId:    { type: 'string' },
                    filename: { type: 'string' },
                    status:   { type: 'string', example: 'done' },
                    mesh: {
                      type: 'object',
                      properties: {
                        positions: { type: 'array', items: { type: 'number' } },
                        normals:   { type: 'array', items: { type: 'number' } },
                        indices:   { type: 'array', items: { type: 'integer' } },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'No file uploaded',   content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Unauthorised',        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          422: { description: 'STEP parse error',    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          504: { description: 'Parse timed out (15 min)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
}
