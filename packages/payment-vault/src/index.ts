export { PaymentVault } from './vault'
export { readPaymentLog, computeDailyTotal } from './isolation'
export { SandboxPaymentProvider } from './sandbox'
export type { SandboxPaymentResult } from './sandbox'

/** True when PAYMENT_SANDBOX=true — no real payments are processed */
export const isSandboxMode = process.env.PAYMENT_SANDBOX === 'true'
