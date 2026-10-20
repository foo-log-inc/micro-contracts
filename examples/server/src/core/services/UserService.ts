/**
 * UserService implementation
 * Business logic separated from framework concerns
 */

import type { UserServiceApi } from '@project/contract/core/services/UserServiceApi.js';
import type * as types from '@project/contract/core/schemas/types.js';

// Mock data store (in real app: database)
const mockUsers: types.User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin', createdAt: '2024-01-01T00:00:00Z' },
  { id: '2', name: 'Bob', email: 'bob@example.com', role: 'user', createdAt: '2024-01-02T00:00:00Z' },
  { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'user', createdAt: '2024-01-03T00:00:00Z' },
];

export class UserService implements UserServiceApi {
  async getUsers(input: types.User_getUsersInput): Promise<types.UserListResponse> {
    // Input is flattened - direct access to limit/offset
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    const users = mockUsers.slice(offset, offset + limit);
    return {
      users,
      total: mockUsers.length,
      hasMore: offset + limit < mockUsers.length,
    };
  }

  async createUser(input: types.User_createUserInput): Promise<types.User> {
    // Request body is in 'data' property
    const { data } = input;
    const newUser: types.User = {
      id: String(mockUsers.length + 1),
      name: data.name,
      email: data.email,
      role: data.role ?? 'user',
      createdAt: new Date().toISOString(),
    };
    mockUsers.push(newUser);
    return newUser;
  }

  async getUserById(input: types.User_getUserByIdInput): Promise<types.User> {
    // Input is flattened - direct access to id
    const user = mockUsers.find(u => u.id === input.id);
    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }
    return user;
  }

  async updateUser(input: types.User_updateUserInput): Promise<types.User> {
    // Input is flattened - id is direct, body is in 'data'
    const { id, data } = input;
    const index = mockUsers.findIndex(u => u.id === id);
    if (index === -1) {
      throw { statusCode: 404, message: 'User not found' };
    }
    // Only the fields UpdateUserRequest declares: a property it does not declare
    // still reaches the service (README, Validators), and must not overwrite
    // the stored user.
    const current = mockUsers[index];
    const updated: types.User = {
      ...current,
      name: data.name ?? current.name,
      role: data.role ?? current.role,
    };
    mockUsers[index] = updated;
    return updated;
  }

  async deleteUser(input: types.User_deleteUserInput): Promise<void> {
    // Input is flattened - direct access to id
    const index = mockUsers.findIndex(u => u.id === input.id);
    if (index === -1) {
      throw { statusCode: 404, message: 'User not found' };
    }
    mockUsers.splice(index, 1);
  }
}
