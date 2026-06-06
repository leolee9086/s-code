# Forever Mode Implementation TODO ✅

## Step 1: Plugin Hook Type Definitions ✅
- [x] Add `loop.continue` hook
- [x] Add `loop.inject` hook  
- [x] Enhance `tool.definition` hook with `add` field

## Step 2: Config Schema ✅
- [x] Create `config/forever.ts` 
- [x] Register `forever` field in `config.ts`

## Step 3: Forever Module Functions ✅
- [x] Create `forever/forever.ts` with pure module functions
- [x] Remove Effect Service pattern to avoid Layer type leaks
- [x] Export: `isEnabled`, `getConfig`, `toolDescription`, `toolName`, `resolvePrompt`, `checkBudget`

## Step 4: Core Loop Modifications ✅
- [x] Modify runLoop exit condition (loop.continue hook)
- [x] Modify auto-continue injection (loop.inject hook)
- [x] Modify loop() entry for auto-wakeup
- [x] Extract `EVOLVE_CONTINUE_PROMPT` constant
- [x] Add createContinueUserMessage / hasPendingContinueMessage helpers

## Step 5: Prefix Commands ✅
- [x] Add `enter-forever` / `exit-forever` prefix commands
- [x] Handle forever commands in createUserMessage
- [x] Add `stop-forever` slash command

## Step 6: Typecheck Passes ✅
- [x] Both `packages/plugin` and `packages/opencode` typecheck ✅
- [x] All Layer/Effect type leaks resolved
- [x] `forever_sleep` tool removed (per design review)

## Design Review Items
- [x] R1: FileWatchDriver polling approach (no EventV2Bridge leak)
- [x] R2: Condition notify handled via loop() entry
- [x] Forever_sleep tool removed (design correction)
