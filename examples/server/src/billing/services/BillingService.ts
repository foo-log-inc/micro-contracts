/**
 * Billing Service Implementation
 * 
 * Demonstrates cross-module dependency via deps/ re-exports.
 * This module depends on core.User for user information.
 * 
 * @see https://github.com/example/micro-contracts/tree/main/examples/server/src/billing/services
 */
import type { BillingServiceApi } from '../../../../packages/contract/billing/services/index.js';
import type {
  Billing_getInvoicesInput,
  Billing_createInvoiceInput,
  Billing_getInvoiceByIdInput,
  Billing_payInvoiceInput,
  InvoiceListResponse,
  Invoice,
  PaymentResult,
} from '../../../../packages/contract/billing/schemas/types.js';

// Import from deps/ - type-safe cross-module dependency
// Only types declared in x-micro-contracts-depend-on are available
import type {
  User,
  UserListResponse,
  User_getUsersInput,
  User_getUserByIdInput,
} from '../../../../packages/contract/billing/deps/core.js';

/**
 * What billing may call on core.User, spelled out from the two operations
 * x-micro-contracts-depend-on declares. core's own UserServiceApi also carries
 * createUser, which billing never declared — depending on that interface would
 * hand this module an operation the contract does not grant it.
 */
interface DeclaredUserService {
  getUsers(input: User_getUsersInput): Promise<UserListResponse>;
  getUserById(input: User_getUserByIdInput): Promise<User>;
}

// Mock data store
const invoices: Invoice[] = [
  {
    id: 'inv-001',
    userId: '1',
    amount: 99.99,
    currency: 'USD',
    status: 'pending',
    description: 'Monthly subscription',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'inv-002',
    userId: '2',
    amount: 149.99,
    currency: 'USD',
    status: 'paid',
    description: 'Annual plan',
    createdAt: new Date().toISOString(),
    paidAt: new Date().toISOString(),
  },
];

export class BillingService implements BillingServiceApi {
  // Inject core.User dependency (declared in x-micro-contracts-depend-on)
  constructor(private userService: DeclaredUserService) {}

  async getInvoices(input: Billing_getInvoicesInput): Promise<InvoiceListResponse> {
    let result = [...invoices];

    // Filter by userId if provided
    if (input.userId) {
      result = result.filter(inv => inv.userId === input.userId);
    }

    // Filter by status if provided
    if (input.status) {
      result = result.filter(inv => inv.status === input.status);
    }

    return {
      invoices: result,
      total: result.length,
    };
  }

  async createInvoice(input: Billing_createInvoiceInput): Promise<Invoice> {
    // Verify user exists using cross-module dependency
    const user = await this.userService.getUserById({ id: input.data.userId });
    if (!user) {
      throw new Error(`User not found: ${input.data.userId}`);
    }

    const invoice: Invoice = {
      id: `inv-${Date.now()}`,
      userId: input.data.userId,
      amount: input.data.amount,
      currency: input.data.currency || 'USD',
      status: 'draft',
      description: input.data.description,
      createdAt: new Date().toISOString(),
    };

    invoices.push(invoice);
    return invoice;
  }

  async getInvoiceById(input: Billing_getInvoiceByIdInput): Promise<Invoice> {
    const invoice = invoices.find(inv => inv.id === input.id);
    if (!invoice) {
      throw new Error(`Invoice not found: ${input.id}`);
    }
    return invoice;
  }

  async payInvoice(input: Billing_payInvoiceInput): Promise<PaymentResult> {
    const invoice = invoices.find(inv => inv.id === input.id);
    if (!invoice) {
      throw new Error(`Invoice not found: ${input.id}`);
    }

    if (invoice.status === 'paid') {
      throw new Error('Invoice already paid');
    }

    // Mock payment processing
    invoice.status = 'paid';
    invoice.paidAt = new Date().toISOString();

    return {
      success: true,
      transactionId: `txn-${Date.now()}`,
      paidAt: invoice.paidAt,
    };
  }
}
