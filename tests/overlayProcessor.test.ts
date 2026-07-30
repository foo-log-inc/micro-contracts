/**
 * Overlay Processor Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { 
  processOverlays, 
  generateExtensionInterfaces,
  type OverlayConfig 
} from '../src/generator/overlayProcessor.js';
import type { OpenAPISpec } from '../src/types.js';
import type { ExtensionInfo } from '../src/generator/overlayProcessor.js';

describe('overlayProcessor', () => {
  let baseSpec: OpenAPISpec;

  beforeEach(() => {
    baseSpec = {
      openapi: '3.0.3',
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      paths: {
        '/api/users': {
          get: {
            operationId: 'getUsers',
            'x-micro-contracts-service': 'User',
            'x-micro-contracts-method': 'getUsers',
            'x-middleware': ['requireAuth'],
            responses: {
              '200': { description: 'Success' },
            },
          },
          post: {
            operationId: 'createUser',
            'x-micro-contracts-service': 'User',
            'x-micro-contracts-method': 'createUser',
            'x-middleware': ['requireAuth', 'tenantIsolation'],
            responses: {
              '201': { description: 'Created' },
            },
          },
        },
        '/api/admin/stats': {
          get: {
            operationId: 'getStats',
            'x-micro-contracts-service': 'Admin',
            'x-micro-contracts-method': 'getStats',
            'x-middleware': ['requireAuth', 'requireAdmin'],
            responses: {
              '200': { description: 'Success' },
            },
          },
        },
      },
    };
  });

  describe('processOverlays', () => {
    it('should apply overlay actions to matching operations', () => {
      // Create a mock overlay file content
      const mockOverlay = `
overlay: 1.0.0
info:
  title: Test Overlay
  version: 1.0.0
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      responses:
        '401':
          description: Unauthorized
`;
      
      // Write mock overlay to temp location
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
      const overlayPath = path.join(tmpDir, 'test.overlay.yaml');
      fs.writeFileSync(overlayPath, mockOverlay);

      const config: OverlayConfig = {
        collision: 'error',
        files: [overlayPath],
      };

      const result = processOverlays(baseSpec, config);

      // Check that 401 was added to all operations with requireAuth
      expect(result.spec.paths['/api/users'].get?.responses['401']).toBeDefined();
      expect(result.spec.paths['/api/users'].post?.responses['401']).toBeDefined();
      expect(result.spec.paths['/api/admin/stats'].get?.responses['401']).toBeDefined();

      // Cleanup
      fs.unlinkSync(overlayPath);
      fs.rmdirSync(tmpDir);
    });

    it('should extract extension info from overlays', () => {
      const mockOverlay = `
overlay: 1.0.0
info:
  title: Test Overlay
  version: 1.0.0
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'tenantIsolation')]"
    update:
      parameters:
        - name: X-Tenant-Id
          in: header
          required: true
          schema:
            type: string
      responses:
        '400':
          description: Bad Request
`;
      
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
      const overlayPath = path.join(tmpDir, 'test.overlay.yaml');
      fs.writeFileSync(overlayPath, mockOverlay);

      const config: OverlayConfig = {
        collision: 'error',
        files: [overlayPath],
      };

      const result = processOverlays(baseSpec, config);

      // Check extension info was extracted
      const tenantInfo = result.extensionInfo.get('x-middleware:tenantIsolation');
      expect(tenantInfo).toBeDefined();
      expect(tenantInfo?.name).toBe('tenantIsolation');
      expect(tenantInfo?.marker).toBe('x-middleware');
      expect(tenantInfo?.injectedParameters).toHaveLength(1);
      expect(tenantInfo?.injectedParameters[0].name).toBe('X-Tenant-Id');
      expect(tenantInfo?.injectedResponses['400']).toBeDefined();

      // Cleanup
      fs.unlinkSync(overlayPath);
      fs.rmdirSync(tmpDir);
    });

    it('should detect collision when same key is injected with different content', () => {
      const overlay1 = `
overlay: 1.0.0
info:
  title: Overlay 1
  version: 1.0.0
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      responses:
        '401':
          description: Unauthorized - Version 1
`;
      
      const overlay2 = `
overlay: 1.0.0
info:
  title: Overlay 2
  version: 1.0.0
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      responses:
        '401':
          description: Unauthorized - Version 2
`;
      
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
      const overlay1Path = path.join(tmpDir, 'overlay1.yaml');
      const overlay2Path = path.join(tmpDir, 'overlay2.yaml');
      fs.writeFileSync(overlay1Path, overlay1);
      fs.writeFileSync(overlay2Path, overlay2);

      const config: OverlayConfig = {
        collision: 'error',
        files: [overlay1Path, overlay2Path],
      };

      // Should throw on collision
      expect(() => processOverlays(baseSpec, config)).toThrow(/collision/i);

      // Cleanup
      fs.unlinkSync(overlay1Path);
      fs.unlinkSync(overlay2Path);
      fs.rmdirSync(tmpDir);
    });

    it('fails when a configured overlay file does not exist', () => {
      // Skipping it would generate artifacts without the overlay's injections
      // and still report success.
      const config: OverlayConfig = {
        collision: 'error',
        files: ['spec/overlays/typo-missing.overlay.yaml'],
      };

      expect(() => processOverlays(baseSpec, config)).toThrow(/Overlay file not found/);
    });

    it('fails on an unsupported overlay target', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
      const overlayPath = path.join(tmpDir, 'bad-target.overlay.yaml');
      fs.writeFileSync(overlayPath, `
overlay: 1.0.0
info:
  title: Bad Target
  version: 1.0.0
actions:
  - target: "$.definitely[not]supported"
    update:
      responses:
        '401':
          description: Unauthorized
`);

      const config: OverlayConfig = { collision: 'error', files: [overlayPath] };

      expect(() => processOverlays(baseSpec, config)).toThrow(/unsupported target/);
    });

    it('should allow identical content on collision (idempotent)', () => {
      const overlay1 = `
overlay: 1.0.0
info:
  title: Overlay 1
  version: 1.0.0
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      responses:
        '401':
          description: Unauthorized
`;
      
      const overlay2 = `
overlay: 1.0.0
info:
  title: Overlay 2
  version: 1.0.0
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      responses:
        '401':
          description: Unauthorized
`;
      
      
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
      const overlay1Path = path.join(tmpDir, 'overlay1.yaml');
      const overlay2Path = path.join(tmpDir, 'overlay2.yaml');
      fs.writeFileSync(overlay1Path, overlay1);
      fs.writeFileSync(overlay2Path, overlay2);

      const config: OverlayConfig = {
        collision: 'error',
        files: [overlay1Path, overlay2Path],
      };

      // Should NOT throw on identical content
      const result = processOverlays(baseSpec, config);
      expect(result.spec.paths['/api/users'].get?.responses['401']).toBeDefined();

      // Cleanup
      fs.unlinkSync(overlay1Path);
      fs.unlinkSync(overlay2Path);
      fs.rmdirSync(tmpDir);
    });

    it('should apply arbitrary update properties beyond parameters and responses', () => {
      const mockOverlay = `
overlay: 1.0.0
info:
  title: Access Logging Overlay
  version: 1.0.0
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'accessLogging')]"
    update:
      x-access-logging:
        enabled: true
        level: detailed
      parameters:
        - name: X-Request-Id
          in: header
          schema:
            type: string
      responses:
        '500':
          description: Internal Server Error
`;
      
      
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
      const overlayPath = path.join(tmpDir, 'test.overlay.yaml');
      fs.writeFileSync(overlayPath, mockOverlay);

      // Add accessLogging to an operation
      (baseSpec.paths['/api/users'].get as any)['x-middleware'] = ['accessLogging'];

      const config: OverlayConfig = {
        collision: 'error',
        files: [overlayPath],
      };

      const result = processOverlays(baseSpec, config);

      const op = result.spec.paths['/api/users'].get as any;

      // x-access-logging should be merged into the operation
      expect(op['x-access-logging']).toEqual({ enabled: true, level: 'detailed' });

      // parameters and responses should also work as before
      expect(op.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'X-Request-Id', in: 'header' }),
        ])
      );
      expect(op.responses['500']).toBeDefined();

      // Non-matching operation should NOT have x-access-logging
      expect((result.spec.paths['/api/admin/stats'].get as any)['x-access-logging']).toBeUndefined();

      // Log should record the extension property change
      const log = result.log.find(l => l.path === '/api/users' && l.method === 'get');
      expect(log?.changes).toContain('+x-access-logging');

      // Cleanup
      fs.unlinkSync(overlayPath);
      fs.rmdirSync(tmpDir);
    });

    it('should log applied overlays', () => {
      const mockOverlay = `
overlay: 1.0.0
info:
  title: Test Overlay
  version: 1.0.0
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      responses:
        '401':
          description: Unauthorized
`;
      
      
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
      const overlayPath = path.join(tmpDir, 'test.overlay.yaml');
      fs.writeFileSync(overlayPath, mockOverlay);

      const config: OverlayConfig = {
        collision: 'error',
        files: [overlayPath],
      };

      const result = processOverlays(baseSpec, config);

      expect(result.appliedOverlays).toHaveLength(1);
      expect(result.log.length).toBeGreaterThan(0);

      // Cleanup
      fs.unlinkSync(overlayPath);
      fs.rmdirSync(tmpDir);
    });
  });

  describe('generateExtensionInterfaces', () => {
    it('should generate TypeScript interfaces from extension info', () => {
      const extensionInfo = new Map<string, ExtensionInfo>([
        ['x-middleware:requireAuth', {
          name: 'requireAuth',
          marker: 'x-middleware',
          injectedParameters: [],
          injectedResponses: { '401': { description: 'Unauthorized' } },
        }],
        ['x-middleware:tenantIsolation', {
          name: 'tenantIsolation',
          marker: 'x-middleware',
          injectedParameters: [
            { name: 'X-Tenant-Id', in: 'header' as const, required: true },
          ],
          injectedResponses: { '400': { description: 'Bad Request' } },
        }],
      ]);

      const result = generateExtensionInterfaces(extensionInfo);

      // Check that it generates valid TypeScript with new Overlay naming
      expect(result).toContain('export type MiddlewareValue');
      expect(result).toContain("'requireAuth'");
      expect(result).toContain("'tenantIsolation'");
      expect(result).toContain('export interface RequireAuthOverlayInput');
      expect(result).toContain('export type RequireAuthOverlay');
      expect(result).toContain('export interface TenantIsolationOverlayInput');
      expect(result).toContain('export type TenantIsolationOverlay');
      expect(result).toContain('export interface MiddlewareRegistry');
      expect(result).toContain('requireAuth: RequireAuthOverlay');
      expect(result).toContain('tenantIsolation: TenantIsolationOverlay');
    });

    it('should include injected parameters in input type and errors in comment', () => {
      const extensionInfo = new Map<string, ExtensionInfo>([
        ['x-middleware:tenantIsolation', {
          name: 'tenantIsolation',
          marker: 'x-middleware',
          injectedParameters: [
            { name: 'X-Tenant-Id', in: 'header' as const, required: true },
          ],
          injectedResponses: { '400': { description: 'Bad Request' } },
        }],
      ]);

      const result = generateExtensionInterfaces(extensionInfo);

      // Parameters are now in input interface, errors in JSDoc comment
      expect(result).toContain("'X-Tenant-Id'");
      expect(result).toContain('May return errors: 400');
    });
  });
});

