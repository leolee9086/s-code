import { Context } from "effect"
import { HttpRouter } from "effect/unstable/http"

// Create mock services
class AuthService extends Context.Service<AuthService, { get: () => string }>()("@opencode/Auth") {}
class InjService extends Context.Service<InjService, { setPrefix: () => void }>()("@opencode/Injection") {}

// Check structural compatibility by forcing assignment
declare const auth: AuthService
declare const req: HttpRouter.Request<"Requires", unknown>

// If this compiles, AuthService IS assignable to HttpRouter.Request
const test1: HttpRouter.Request<"Requires", unknown> = auth

// If this compiles, InjService IS also assignable
const test2: HttpRouter.Request<"Requires", unknown> = null as unknown as InjService
