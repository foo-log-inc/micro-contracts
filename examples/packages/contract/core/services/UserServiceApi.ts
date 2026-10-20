/**
 * User Service API Interface
 * Auto-generated from OpenAPI specification
 * DO NOT EDIT MANUALLY
 */

import type {
  Session,
  User,
  UserListResponse,
  User_createUserInput,
  User_deleteUserInput,
  User_getSessionInput,
  User_getUserByIdInput,
  User_getUsersInput,
  User_updateUserInput,
} from '../schemas/types.js';

export interface UserServiceApi {
  /**
   * GET /api/users
   */
  getUsers(input: User_getUsersInput): Promise<UserListResponse>;

  /**
   * POST /api/users
   */
  createUser(input: User_createUserInput): Promise<User>;

  /**
   * GET /api/users/{id}
   */
  getUserById(input: User_getUserByIdInput): Promise<User>;

  /**
   * PUT /api/users/{id}
   * @internal Not included in public contract
   */
  updateUser(input: User_updateUserInput): Promise<User>;

  /**
   * DELETE /api/users/{id}
   * @internal Not included in public contract
   */
  deleteUser(input: User_deleteUserInput): Promise<void>;

  /**
   * GET /api/session
   * @internal Not included in public contract
   */
  getSession(input: User_getSessionInput): Promise<Session>;

}