/**
 * Service interface generator from OpenAPI specification
 * 
 * Generates TypeScript interfaces grouped by x-micro-contracts-service extension.
 * Supports custom Handlebars templates for service interface generation.
 */

import fs from 'fs';
import Handlebars from 'handlebars';
import type { 
  OpenAPISpec, 
  OperationObject,
  ParameterObject,
  ServiceInfo,
  ServiceMethodInfo,
} from '../types.js';
import { isReference, getRefName } from '../types.js';

export interface ServiceGeneratorOptions {
  /** Only include public endpoints (x-public: true) */
  publicOnly?: boolean;
  /** Path to custom Handlebars template for service interface generation */
  serviceTemplate?: string;
}

/**
 * Context passed to custom service interface templates (per-service)
 */
export interface ServiceTemplateContext {
  serviceName: string;
  interfaceName: string;
  methods: ServiceMethodTemplateContext[];
  imports: string[];
  spec: OpenAPISpec;
}

export interface ServiceMethodTemplateContext {
  name: string;
  inputType: string;
  returnType: string;
  returnTypeStr: string;
  httpMethod: string;
  path: string;
  isPublished: boolean;
  parameters: ParameterObject[];
  requestBodySchema?: string;
  extensions: Record<string, unknown>;
}

/**
 * Generate service interface files
 * Returns a map of service name to generated content
 */
export function generateServiceInterfaces(
  spec: OpenAPISpec,
  options: ServiceGeneratorOptions = {}
): Map<string, string> {
  const { publicOnly = false, serviceTemplate } = options;
  
  const services = extractServiceInfo(spec, publicOnly);
  const result = new Map<string, string>();
  
  const compiledTemplate = serviceTemplate
    ? compileServiceTemplate(serviceTemplate)
    : null;
  
  for (const service of services) {
    const content = compiledTemplate
      ? generateServiceInterfaceFromTemplate(compiledTemplate, service, spec)
      : generateServiceInterface(service, spec);
    result.set(service.name, content);
  }
  
  // Generate index.ts
  const indexContent = generateServicesIndex(services);
  result.set('index', indexContent);
  
  return result;
}

/**
 * Load and compile a custom service template
 */
function compileServiceTemplate(templatePath: string): Handlebars.TemplateDelegate {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Service template not found: ${templatePath}`);
  }
  const content = fs.readFileSync(templatePath, 'utf-8');
  return Handlebars.compile(content, { noEscape: true });
}

/**
 * Extract service information from OpenAPI spec
 */
function extractServiceInfo(spec: OpenAPISpec, publicOnly: boolean): ServiceInfo[] {
  const servicesMap = new Map<string, ServiceMethodInfo[]>();
  
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      
      // Canonical extension names only
      const service = operation['x-micro-contracts-service'];
      const serviceMethod = operation['x-micro-contracts-method'];
      const isPublished = operation['x-micro-contracts-published'] === true;
      
      if (!service || !serviceMethod) continue;
      if (publicOnly && !isPublished) continue;
      
      const methodInfo = extractMethodInfo(path, method, operation, spec);
      if (!methodInfo) continue;
      
      if (!servicesMap.has(service)) {
        servicesMap.set(service, []);
      }
      servicesMap.get(service)!.push(methodInfo);
    }
  }
  
  return Array.from(servicesMap.entries())
    .map(([name, methods]) => ({ name, methods }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract method information from operation
 */
function extractMethodInfo(
  path: string,
  httpMethod: string,
  operation: OperationObject,
  spec: OpenAPISpec
): ServiceMethodInfo | null {
  // Canonical extension names only
  const serviceName = operation['x-micro-contracts-service'];
  const serviceMethod = operation['x-micro-contracts-method'];
  if (!serviceMethod) return null;
  
  const operationId = operation.operationId || serviceMethod;
  // Use service + _ + method for type names (clearer separation)
  const typeNameBase = serviceName && serviceMethod 
    ? `${serviceName}_${serviceMethod}`
    : operationId.replace(/[^a-zA-Z0-9]/g, '_');
  const isPublished = operation['x-micro-contracts-published'] === true;
  
  // Get request body type
  let requestType: string | undefined;
  if (operation.requestBody) {
    const reqBody = isReference(operation.requestBody)
      ? spec.components?.requestBodies?.[getRefName(operation.requestBody.$ref)]
      : operation.requestBody;
    
    if (reqBody) {
      const content = reqBody.content?.['application/json'];
      if (content?.schema) {
        requestType = isReference(content.schema)
          ? getRefName(content.schema.$ref)
          : undefined;
      }
    }
  }
  
  // Get response type
  let responseType: string | undefined;
  const successResponse = operation.responses['200'] || operation.responses['201'];
  if (successResponse) {
    const resp = isReference(successResponse)
      ? spec.components?.responses?.[getRefName(successResponse.$ref)]
      : successResponse;
    
    if (resp?.content?.['application/json']?.schema) {
      const schema = resp.content['application/json'].schema;
      responseType = isReference(schema) ? getRefName(schema.$ref) : undefined;
    }
  }
  
  // Check for 204 (void response)
  if (operation.responses['204'] && !responseType) {
    responseType = 'void';
  }
  
  // Get all params (path + query combined)
  const allParams = (operation.parameters || []).filter(
    (p): p is ParameterObject => !isReference(p)
  );
  const queryParams = allParams.filter(p => p.in === 'query');
  const pathParams = allParams.filter(p => p.in === 'path');
  const hasParams = queryParams.length > 0 || pathParams.length > 0;
  const paramsType = hasParams ? `${typeNameBase}Params` : undefined;
  
  // Request body schema name
  let requestBodySchema: string | undefined;
  if (operation.requestBody) {
    const reqBody = isReference(operation.requestBody)
      ? spec.components?.requestBodies?.[getRefName(operation.requestBody.$ref)]
      : operation.requestBody;
    if (reqBody?.content?.['application/json']?.schema) {
      const schema = reqBody.content['application/json'].schema;
      requestBodySchema = isReference(schema) ? getRefName(schema.$ref) : undefined;
    }
  }
  
  // Collect all x-* extensions from the operation
  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(operation as unknown as Record<string, unknown>)) {
    if (key.startsWith('x-')) {
      extensions[key] = value;
    }
  }
  
  return {
    name: serviceMethod,
    operationId,
    httpMethod,
    path,
    isPublished,
    requestType,
    responseType,
    paramsType,
    parameters: allParams,
    requestBodySchema,
    extensions,
  };
}

/**
 * Generate service interface content
 */
function generateServiceInterface(service: ServiceInfo, _spec: OpenAPISpec): string {
  const lines: string[] = [];
  
  lines.push('/**');
  lines.push(` * ${service.name} Service API Interface`);
  lines.push(' * Auto-generated from OpenAPI specification');
  lines.push(' * DO NOT EDIT MANUALLY');
  lines.push(' */');
  lines.push('');
  
  // Collect all types needed
  const types = new Set<string>();
  for (const method of service.methods) {
    // Always use Input type (even for parameterless operations)
    const inputTypeName = `${service.name}_${method.name}Input`;
    types.add(inputTypeName);
    if (method.responseType && method.responseType !== 'void') types.add(method.responseType);
  }
  
  // Generate imports
  if (types.size > 0) {
    const typeList = Array.from(types).sort().join(',\n  ');
    lines.push('import type {');
    lines.push(`  ${typeList},`);
    lines.push("} from '../schemas/types.js';");
    lines.push('');
  }
  
  // Generate interface
  lines.push(`export interface ${service.name}ServiceApi {`);
  
  for (const method of service.methods) {
    // JSDoc comment
    lines.push('  /**');
    lines.push(`   * ${method.httpMethod.toUpperCase()} ${method.path}`);
    if (!method.isPublished) {
      lines.push('   * @internal Not included in public contract');
    }
    lines.push('   */');
    
    // Method signature with single Input parameter (always present)
    const inputTypeName = `${service.name}_${method.name}Input`;
    const returnType = method.responseType || 'void';
    const returnTypeStr = returnType === 'void' ? 'Promise<void>' : `Promise<${returnType}>`;
    
    lines.push(`  ${method.name}(input: ${inputTypeName}): ${returnTypeStr};`);
    lines.push('');
  }
  
  lines.push('}');
  
  return lines.join('\n');
}

/**
 * Generate service interface content using a custom Handlebars template
 */
function generateServiceInterfaceFromTemplate(
  template: Handlebars.TemplateDelegate,
  service: ServiceInfo,
  spec: OpenAPISpec
): string {
  const imports = collectImportsForService(service);
  
  const methods: ServiceMethodTemplateContext[] = service.methods.map(method => {
    const inputType = `${service.name}_${method.name}Input`;
    const returnType = method.responseType || 'void';
    const returnTypeStr = returnType === 'void' ? 'Promise<void>' : `Promise<${returnType}>`;
    
    return {
      name: method.name,
      inputType,
      returnType,
      returnTypeStr,
      httpMethod: method.httpMethod.toUpperCase(),
      path: method.path,
      isPublished: method.isPublished,
      parameters: method.parameters,
      requestBodySchema: method.requestBodySchema,
      extensions: method.extensions,
    };
  });
  
  const context: ServiceTemplateContext = {
    serviceName: service.name,
    interfaceName: `${service.name}ServiceApi`,
    methods,
    imports,
    spec,
  };
  
  return template(context);
}

/**
 * Collect import type names needed for a service
 */
function collectImportsForService(service: ServiceInfo): string[] {
  const types = new Set<string>();
  for (const method of service.methods) {
    types.add(`${service.name}_${method.name}Input`);
    if (method.responseType && method.responseType !== 'void') {
      types.add(method.responseType);
    }
  }
  return Array.from(types).sort();
}

/**
 * Generate services index.ts
 */
function generateServicesIndex(services: ServiceInfo[]): string {
  const lines: string[] = [];
  
  lines.push('/**');
  lines.push(' * Service API Interfaces');
  lines.push(' * Auto-generated from OpenAPI specification');
  lines.push(' * DO NOT EDIT MANUALLY');
  lines.push(' */');
  lines.push('');
  
  // Import service APIs for use in ServiceRegistry
  for (const service of services) {
    lines.push(`import type { ${service.name}ServiceApi } from './${service.name}ServiceApi.js';`);
  }
  lines.push('');
  
  // Re-export individual service APIs
  for (const service of services) {
    lines.push(`export type { ${service.name}ServiceApi };`);
  }
  
  // Generate ServiceRegistry interface for DI Container
  lines.push('');
  lines.push('/**');
  lines.push(' * Service Registry for Dependency Injection');
  lines.push(' * Use this interface for DI container type definitions');
  lines.push(' */');
  lines.push('export interface ServiceRegistry {');
  
  for (const service of services) {
    const propertyName = serviceNameToProperty(service.name);
    lines.push(`  ${propertyName}: ${service.name}ServiceApi;`);
  }
  
  lines.push('}');
  
  return lines.join('\n');
}

/**
 * Convert service name to property name
 * e.g., "Account" -> "account", "ExtensionInstance" -> "extensionInstance"
 */
function serviceNameToProperty(serviceName: string): string {
  // Remove "Service" suffix if present
  const baseName = serviceName.replace(/Service$/, '');
  // Convert to camelCase (first letter lowercase)
  return baseName.charAt(0).toLowerCase() + baseName.slice(1);
}

