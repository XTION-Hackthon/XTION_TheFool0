# Implementation Plan

## Bug 1: 移动主链路断裂，服务端状态不同步

- [x] 1.1 Write bug condition exploration test for Bug 1
  - **Property 1: Fault Condition** - 移动同步缺失
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate `/api/move` is not called after successful validation
  - **Scoped PBT Approach**: Test concrete failing case - client calls `validate-move` with valid move, then check if `/api/move` is called
  - Test implementation details from Fault Condition in design:
    - Client calls `POST /api/collision/validate-move` and receives `{"valid":true}`
    - Monitor whether `/api/move` is subsequently called
    - Query server state via `/api/status/:id` to verify position is NOT updated
  - The test assertions should match the Expected Behavior Properties from design (Requirements 2.1, 2.2, 2.3)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found:
    - `/api/move` not called after successful validation
    - Server `contestants` table position not updated
    - Other clients query old position instead of new position
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 1.2 Write preservation property tests for Bug 1 (BEFORE implementing fix)
  - **Property 2: Preservation** - 移动错误处理保持不变
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs:
    - When `validate-move` returns `{"valid":false}`, client rejects the move
    - When network error occurs, client returns error message
    - When server error occurs, client maintains original error handling
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements (Requirements 3.1, 3.2)
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2_

- [x] 1.3 Fix for Bug 1: 移动主链路断裂

  - [x] 1.3.1 Implement the fix in `client/src/game/GameScene.ts`
    - Modify `handleBotMovement` function to call `/api/move` after successful validation
    - Add error handling: if `/api/move` fails, rollback local state update
    - Preserve existing validation logic (steps 1-7 remain unchanged)
    - _Bug_Condition: isBugCondition_Bug1(input) where validateMoveResponse.valid == true AND moveAPICalled == false_
    - _Expected_Behavior: After validation passes, client SHALL call `/api/move` to sync server state (Requirements 2.1, 2.2, 2.3)_
    - _Preservation: Error handling for invalid moves and network errors SHALL remain unchanged (Requirements 3.1, 3.2)_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

  - [x] 1.3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - 移动同步已修复
    - **IMPORTANT**: Re-run the SAME test from task 1.1 - do NOT write a new test
    - The test from task 1.1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1.1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - 错误处理保持不变
    - **IMPORTANT**: Re-run the SAME tests from task 1.2 - do NOT write new tests
    - Run preservation property tests from step 1.2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2_

## Bug 2: 核心身份归属可在运行时被冒用

- [x] 2.1 Write bug condition exploration test for Bug 2
  - **Property 1: Fault Condition** - 身份冒用漏洞
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate identity spoofing is possible
  - **Scoped PBT Approach**: Test concrete failing case - new key without contestant sends request with victim's senderId
  - Test implementation details from Fault Condition in design:
    - Use new Agent_Player key (no contestant record yet)
    - Send request with body containing victim's `senderId` or `contestant_id`
    - Verify request is ACCEPTED (on unfixed code) and modifies victim's state
  - The test assertions should match the Expected Behavior Properties from design (Requirements 2.4, 2.5)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found:
    - New key can modify other player's server state
    - Auth middleware allows requests without contestant validation
    - Route layer falls back to body's senderId without verification
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.4, 1.5_

- [x] 2.2 Write preservation property tests for Bug 2 (BEFORE implementing fix)
  - **Property 2: Preservation** - 合法请求保持不变
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs:
    - Valid Agent_Player key with established contestant sends request with own senderId - request succeeds
    - Admin role sends request - request succeeds (no contestant required)
    - Normal move, broadcast, heartbeat operations - all work correctly
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements (Requirements 3.3, 3.4)
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.3, 3.4_

- [x] 2.3 Fix for Bug 2: 核心身份归属可在运行时被冒用

  - [x] 2.3.1 Implement the fix in `server/src/middleware/auth.ts`
    - Modify `authMiddleware` to reject requests when key is valid but contestant doesn't exist (except Admin)
    - Return 401 error with code `AUTH_NO_CONTESTANT` and message "Key 有效但尚未建立 contestant 记录，请先完成 WebSocket 认证"
    - Preserve Admin role permissions (Admin doesn't require contestant)
    - _Bug_Condition: isBugCondition_Bug2(input) where keyValid == true AND contestantExists == false AND bodyContestantId != authenticatedContestantId_
    - _Expected_Behavior: System SHALL reject requests and return 401/403 error (Requirements 2.4, 2.5)_
    - _Preservation: Legitimate requests with established contestant SHALL continue to work (Requirements 3.3, 3.4)_
    - _Requirements: 2.4, 2.5, 3.3, 3.4_

  - [x] 2.3.2 Remove fallback logic in route handlers
    - Remove `getContestantFromRequest` fallback logic in `server/src/routes/move.ts`, `server/src/routes/broadcast.ts`, etc.
    - Directly use `req.contestantId` (which is now guaranteed to be valid by middleware)
    - _Requirements: 2.4, 2.5_

  - [x] 2.3.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - 身份冒用已阻止
    - **IMPORTANT**: Re-run the SAME test from task 2.1 - do NOT write a new test
    - The test from task 2.1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 2.1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.4, 2.5_

  - [x] 2.3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - 合法请求保持不变
    - **IMPORTANT**: Re-run the SAME tests from task 2.2 - do NOT write new tests
    - Run preservation property tests from step 2.2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.3, 3.4_

## Bug 3: 观战主链路只拿首帧，不拿后续世界变化

- [x] 3.1 Write bug condition exploration test for Bug 3
  - **Property 1: Fault Condition** - 观战事件推送缺失
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate Agent_Viewer doesn't receive subsequent events
  - **Scoped PBT Approach**: Test concrete failing case - Agent_Viewer connects, then trigger world change events
  - Test implementation details from Fault Condition in design:
    - Agent_Viewer establishes WebSocket connection and authenticates
    - Verify initial `world.state` is received
    - Trigger world change events (player move, join, leave)
    - Verify subsequent events are NOT received (on unfixed code)
  - The test assertions should match the Expected Behavior Properties from design (Requirements 2.6, 2.7)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found:
    - Agent_Viewer receives initial `world.state` only
    - Agent_Viewer doesn't receive `contestant.join`, `room.bot_position`, `contestant.leave` events
    - Agent_Viewer connection not registered in `connections` Map
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.6, 1.7_

- [x] 3.2 Write preservation property tests for Bug 3 (BEFORE implementing fix)
  - **Property 2: Preservation** - Agent_Player 行为保持不变
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs:
    - Agent_Player connects and receives initial `world.state` and subsequent events
    - World state changes are broadcast to all Agent_Player connections
    - Agent_Viewer cannot send game commands (move, talk, broadcast, heartbeat)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements (Requirements 3.5, 3.6)
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.5, 3.6_

- [x] 3.3 Fix for Bug 3: 观战主链路只拿首帧

  - [x] 3.3.1 Implement the fix in `server/src/ws.ts`
    - Modify `handleAuth` to register Agent_Viewer connections after sending `world.state`
    - Add Agent_Viewer connection to `connections` Map (or create separate `viewerConnections` Map)
    - Update `broadcast()` function to include Agent_Viewer connections
    - Preserve Agent_Viewer command restrictions (cannot send game commands)
    - _Bug_Condition: isBugCondition_Bug3(input) where role == 'Agent_Viewer' AND worldStateReceived == true AND connectionRegistered == false_
    - _Expected_Behavior: System SHALL register Agent_Viewer connections and broadcast subsequent events (Requirements 2.6, 2.7)_
    - _Preservation: Agent_Player behavior and Agent_Viewer command restrictions SHALL remain unchanged (Requirements 3.5, 3.6)_
    - _Requirements: 2.6, 2.7, 3.5, 3.6_

  - [x] 3.3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - 观战事件推送已修复
    - **IMPORTANT**: Re-run the SAME test from task 3.1 - do NOT write a new test
    - The test from task 3.1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 3.1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.6, 2.7_

  - [x] 3.3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Agent_Player 行为保持不变
    - **IMPORTANT**: Re-run the SAME tests from task 3.2 - do NOT write new tests
    - Run preservation property tests from step 3.2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.5, 3.6_

## Bug 4: Bot 显示依赖 WebSocket 认证，REST join 不创建 contestant

- [x] 4.1 Write bug condition exploration test for Bug 4
  - **Property 1: Fault Condition** - REST join 不创建 contestant
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate REST join doesn't create contestant
  - **Scoped PBT Approach**: Test concrete failing case - new key calls REST join without prior WebSocket auth
  - Test implementation details from Fault Condition in design:
    - Use new Agent_Player key (no prior WebSocket authentication)
    - Call `POST /api/rooms/:id/join` via REST API
    - Verify `contestants` table does NOT have record (on unfixed code)
    - Verify `room_bots` table has record with `keys.id` instead of `contestant.id`
    - Verify client renderer does NOT display the bot
  - The test assertions should match the Expected Behavior Properties from design (Requirements 2.8, 2.9)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found:
    - REST join doesn't create `contestants` record
    - `room_bots.bot_id` is `keys.id` instead of `contestant.id`
    - Renderer doesn't display bot (only shows WebSocket-authenticated players)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.8, 1.9_

- [x] 4.2 Write preservation property tests for Bug 4 (BEFORE implementing fix)
  - **Property 2: Preservation** - WebSocket 认证流程保持不变
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs:
    - Client completes WebSocket authentication then REST join - contestant created, bot displayed
    - Renderer displays WebSocket-authenticated players correctly
    - Room capacity checks and spawn point allocation work correctly
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements (Requirements 3.7, 3.8)
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.7, 3.8_

- [x] 4.3 Fix for Bug 4: Bot 显示依赖 WebSocket 认证

  - [x] 4.3.1 Implement the fix in `server/src/routes/rooms.ts`
    - Modify `POST /:id/join` to create contestant record if it doesn't exist
    - Use `req.keyId` to fetch `contestant_name` from `keys` table
    - Create contestant with provided position or allocated spawn point
    - Ensure `req.contestantId` is set to real `contestant.id` before calling `addBotToRoom()`
    - Preserve WebSocket authentication flow (upsertContestant logic unchanged)
    - _Bug_Condition: isBugCondition_Bug4(input) where joinMethod == 'REST' AND contestantExists == false_
    - _Expected_Behavior: System SHALL create contestant record and use real contestant.id in room_bots (Requirements 2.8, 2.9)_
    - _Preservation: WebSocket authentication flow and renderer behavior SHALL remain unchanged (Requirements 3.7, 3.8)_
    - _Requirements: 2.8, 2.9, 3.7, 3.8_

  - [x] 4.3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - REST join 创建 contestant 已修复
    - **IMPORTANT**: Re-run the SAME test from task 4.1 - do NOT write a new test
    - The test from task 4.1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 4.1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.8, 2.9_

  - [x] 4.3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - WebSocket 认证流程保持不变
    - **IMPORTANT**: Re-run the SAME tests from task 4.2 - do NOT write new tests
    - Run preservation property tests from step 4.2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.7, 3.8_

## Final Checkpoint

- [x] 5. Checkpoint - Ensure all tests pass
  - Run all exploration tests (tasks 1.1, 2.1, 3.1, 4.1) - all should PASS
  - Run all preservation tests (tasks 1.2, 2.2, 3.2, 4.2) - all should PASS
  - Run integration tests to verify end-to-end functionality
  - Ensure no regressions in existing functionality
  - Ask the user if questions arise
