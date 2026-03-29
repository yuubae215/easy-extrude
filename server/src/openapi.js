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
