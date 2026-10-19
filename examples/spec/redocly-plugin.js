// Redocly lint rules that configurable rules (assertions) cannot express.
// Enabled from spec/redocly.yaml as `micro-contracts/<rule>`.

const SUCCESS_RANGES = new Set(['2XX', '3XX']);

// A `$ref` object must not carry other keys: OpenAPI 3.0 ignores them, so a
// `description` or `nullable` written next to `$ref` silently has no effect.
// OpenAPI 3.1 allows siblings, so the rule applies to 3.0 documents only.
function NoRefSiblings() {
  return {
    ref: {
      enter(node, { report, location, specVersion }) {
        if (specVersion !== 'oas3_0') return;
        for (const key of Object.keys(node)) {
          if (key === '$ref') continue;
          report({
            message: '$ref must not be placed next to any other properties',
            location: location.child([key]).key(),
          });
        }
      },
    },
  };
}

// Every operation needs at least one 2xx or 3xx response.
function OperationSuccessResponse() {
  return {
    Operation: {
      Responses(responses, { report, location }) {
        const codes = Object.keys(responses);
        const ok = codes.some((code) => SUCCESS_RANGES.has(code) || (Number(code) >= 200 && Number(code) < 400));
        if (!ok) {
          report({
            message: 'Operation must define at least a single 2xx or 3xx response',
            location: location.key(),
          });
        }
      },
    },
  };
}

// Every security requirement must name a scheme defined in
// components.securitySchemes, and every scope it lists must be declared by one
// of that scheme's flows. An operation without security is not reported.
function SecurityDefined() {
  let schemes = {};
  const requirements = [];
  return {
    Root: {
      enter(root) {
        schemes = root.components?.securitySchemes ?? {};
      },
      leave(_root, { report }) {
        for (const { requirement, location } of requirements) {
          for (const [name, scopes] of Object.entries(requirement)) {
            const scheme = schemes[name];
            if (!scheme) {
              report({
                message: `"security" values must match a scheme defined in the "components.securitySchemes" object.`,
                location: location.child([name]).key(),
              });
              continue;
            }
            const declared = Object.values(scheme.flows ?? {}).flatMap((flow) => Object.keys(flow?.scopes ?? {}));
            (scopes ?? []).forEach((scope, i) => {
              if (!declared.includes(scope)) {
                report({
                  message: `"${scope}" must be listed among scopes.`,
                  location: location.child([name, i]),
                });
              }
            });
          }
        }
      },
    },
    SecurityRequirement(requirement, { location }) {
      requirements.push({ requirement, location });
    },
  };
}

export default function microContractsLintPlugin() {
  return {
    id: 'micro-contracts',
    rules: {
      oas3: {
        'no-ref-siblings': NoRefSiblings,
        'operation-success-response': OperationSuccessResponse,
        'security-defined': SecurityDefined,
      },
    },
  };
}
