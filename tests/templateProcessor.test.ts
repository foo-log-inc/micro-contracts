/**
 * Template Processor Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  buildTemplateContext,
  loadTemplate,
  processTemplate,
  renderTemplate,
} from '../src/generator/templateProcessor.js';
import type { OpenAPISpec } from '../src/types.js';
import type { ExtensionInfo } from '../src/generator/overlayProcessor.js';

describe('templateProcessor', () => {
  let testSpec: OpenAPISpec;

  beforeEach(() => {
    testSpec = {
      openapi: '3.0.3',
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      paths: {
        '/api/users': {
          get: {
            operationId: 'getUsers',
            summary: 'Get users list',
            'x-micro-contracts-service': 'User',
            'x-micro-contracts-method': 'getUsers',
            'x-micro-contracts-published': true,
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/UserList' },
                  },
                },
              },
            },
          },
          post: {
            operationId: 'createUser',
            summary: 'Create user',
            'x-micro-contracts-service': 'User',
            'x-micro-contracts-method': 'createUser',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreateUser' },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
        },
        '/api/users/{id}': {
          get: {
            operationId: 'getUserById',
            summary: 'Get user by ID',
            'x-micro-contracts-service': 'User',
            'x-micro-contracts-method': 'getUserById',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          User: { type: 'object' },
          UserList: { type: 'object' },
          CreateUser: { type: 'object' },
        },
      },
    };
  });

  describe('buildTemplateContext', () => {
    it('should extract routes from spec', () => {
      const context = buildTemplateContext(testSpec, 'core');

      expect(context.routes).toHaveLength(3);
      expect(context.routes[0].path).toBe('/api/users');
      expect(context.routes[0].method).toBe('get');
      expect(context.routes[0].service).toBe('User');
      expect(context.routes[0].serviceMethod).toBe('getUsers');
    });

    it('should extract services from routes', () => {
      const context = buildTemplateContext(testSpec, 'core');

      expect(context.services).toHaveLength(1);
      expect(context.services[0].name).toBe('User');
      expect(context.services[0].key).toBe('user');
      expect(context.services[0].methods).toContain('getUsers');
      expect(context.services[0].methods).toContain('createUser');
      expect(context.services[0].methods).toContain('getUserById');
    });

    it('should convert path params to Fastify format', () => {
      const context = buildTemplateContext(testSpec, 'core');

      const getUserByIdRoute = context.routes.find(r => r.operationId === 'getUserById');
      expect(getUserByIdRoute?.fastifyPath).toBe('/api/users/:id');
    });

    it('should include extension info when provided', () => {
      const extensionInfo = new Map<string, ExtensionInfo>([
        ['x-middleware:requireAuth', {
          name: 'requireAuth',
          marker: 'x-middleware',
          injectedParameters: [],
          injectedResponses: { '401': { description: 'Unauthorized' } },
        }],
      ]);

      const context = buildTemplateContext(testSpec, 'core', { extensionInfo });

      expect(context.extensionInfo).toHaveLength(1);
      expect(context.extensionInfo[0].name).toBe('requireAuth');
    });

    it('should set correct module name and paths', () => {
      const context = buildTemplateContext(testSpec, 'users', {
        servicesPath: 'fastify.services.users',
        contractPackage: '@myapp/contract/users',
      });

      expect(context.moduleName).toBe('users');
      expect(context.servicesPath).toBe('fastify.services.users');
      expect(context.contractPackage).toBe('@myapp/contract/users');
    });

    it('should identify public routes', () => {
      const context = buildTemplateContext(testSpec, 'core');

      const getUsersRoute = context.routes.find(r => r.operationId === 'getUsers');
      const createUserRoute = context.routes.find(r => r.operationId === 'createUser');

      expect(getUsersRoute?.isPublished).toBe(true);
      expect(createUserRoute?.isPublished).toBe(false);
    });
  });

  describe('processTemplate', () => {
    it('should render template with context', () => {
      const template = Handlebars.compile('Hello {{moduleName}}!');
      const context = buildTemplateContext(testSpec, 'core');

      const result = processTemplate(template, context);

      expect(result).toBe('Hello core!');
    });

    it('should iterate over routes', () => {
      const template = Handlebars.compile(
        '{{#each routes}}{{operationId}}\\n{{/each}}'
      );
      const context = buildTemplateContext(testSpec, 'core');

      const result = processTemplate(template, context);

      expect(result).toContain('getUsers');
      expect(result).toContain('createUser');
      expect(result).toContain('getUserById');
    });
  });

  describe('renderTemplate', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-template-test-'));
    });

    it('renders the configured template', () => {
      const templatePath = path.join(tmpDir, 'routes.hbs');
      fs.writeFileSync(templatePath, 'routes: {{routes.length}}');
      const context = buildTemplateContext(testSpec, 'core', {});

      const result = renderTemplate(templatePath, context, "output 'routes'");

      expect(result).toBe(`routes: ${context.routes.length}`);
    });

    it('throws when the configured template does not exist', () => {
      const missing = path.join(tmpDir, 'typo.hbs');
      const context = buildTemplateContext(testSpec, 'core', {});

      expect(() => renderTemplate(missing, context, "output 'routes'")).toThrow(
        /Cannot load template .*typo\.hbs.* for output 'routes'/
      );
    });

    it('throws when the template cannot be rendered', () => {
      const templatePath = path.join(tmpDir, 'broken.hbs');
      fs.writeFileSync(templatePath, '{{#each routes}}{{/wrongclose}}');
      const context = buildTemplateContext(testSpec, 'core', {});

      expect(() => renderTemplate(templatePath, context, "output 'routes'")).toThrow(
        /Cannot (load|render) template .*broken\.hbs.* for output 'routes'/
      );
    });
  });

  describe('Handlebars helpers', () => {
    it('should have eq helper', () => {
      const template = Handlebars.compile('{{#if (eq a b)}}equal{{else}}not equal{{/if}}');
      expect(template({ a: 1, b: 1 })).toBe('equal');
      expect(template({ a: 1, b: 2 })).toBe('not equal');
    });

    it('should have uppercase helper', () => {
      const template = Handlebars.compile('{{uppercase method}}');
      expect(template({ method: 'get' })).toBe('GET');
    });

    it('should have camelCase helper', () => {
      const template = Handlebars.compile('{{camelCase name}}');
      expect(template({ name: 'x-middleware' })).toBe('xMiddleware');
      expect(template({ name: 'balance_sheet' })).toBe('balanceSheet');
    });

    it('should have pascalCase helper', () => {
      const template = Handlebars.compile('{{pascalCase name}}');
      expect(template({ name: 'x-middleware' })).toBe('XMiddleware');
      expect(template({ name: 'balance_sheet' })).toBe('BalanceSheet');
    });

    it('should have snakeCase helper', () => {
      const template = Handlebars.compile('{{snakeCase name}}');
      expect(template({ name: 'getUserById' })).toBe('get_user_by_id');
      expect(template({ name: 'x-middleware' })).toBe('x_middleware');
      expect(template({ name: 'UserService' })).toBe('user_service');
    });

    it('should have refName helper', () => {
      const template = Handlebars.compile('{{refName ref}}');
      expect(template({ ref: '#/components/schemas/LoadStatus' })).toBe('LoadStatus');
      expect(template({ ref: '#/components/schemas/User' })).toBe('User');
      expect(template({ ref: '' })).toBe('');
    });

    it('should have join helper', () => {
      const template = Handlebars.compile('{{join items ", "}}');
      expect(template({ items: ['a', 'b', 'c'] })).toBe('a, b, c');
    });

    it('should have first helper', () => {
      const template = Handlebars.compile('{{first items}}');
      expect(template({ items: ['a', 'b', 'c'] })).toBe('a');
    });

    it('should have json helper', () => {
      const template = Handlebars.compile('{{{json obj}}}');
      const result = template({ obj: { a: 1 } });
      expect(JSON.parse(result)).toEqual({ a: 1 });
    });
  });

  describe('loadTemplate', () => {
    it('should load template from file', () => {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
      const templatePath = path.join(tmpDir, 'test.hbs');
      fs.writeFileSync(templatePath, 'Hello {{name}}!');

      const template = loadTemplate(templatePath);
      const result = template({ name: 'World' });

      expect(result).toBe('Hello World!');

      // Cleanup
      fs.unlinkSync(templatePath);
      fs.rmdirSync(tmpDir);
    });

    it('should throw if template not found', () => {
      expect(() => loadTemplate('/nonexistent/template.hbs')).toThrow();
    });
  });
});

