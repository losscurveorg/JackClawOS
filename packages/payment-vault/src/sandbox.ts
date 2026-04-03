/**
 * PaymentVault Sandbox Mode
 * 开发/测试环境使用，不发起真实支付
 * PAYMENT_SANDBOX=true 时自动启用
 */

export interface SandboxPaymentResult {
  transactionId: string
  status: "approved" | "declined" | "pending"
  amount: number
  currency: string
  timestamp: number
  note: string  // "Sandbox payment — no real money moved"
}

export class SandboxPaymentProvider {
  readonly isSandbox = true

  // 模拟支付（固定成功，除非金额>9999）
  async charge(amount: number, currency = "USD", description = ""): Promise<SandboxPaymentResult> {
    void description
    await new Promise(r => setTimeout(r, 200))  // 模拟网络延迟
    const approved = amount <= 9999
    return {
      transactionId: `sandbox_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      status: approved ? "approved" : "declined",
      amount,
      currency,
      timestamp: Date.now(),
      note: approved
        ? "✅ Sandbox payment approved — no real money moved"
        : "❌ Sandbox decline — amount exceeds sandbox limit ($9,999)",
    }
  }

  // 模拟退款
  async refund(transactionId: string, amount?: number): Promise<SandboxPaymentResult> {
    await new Promise(r => setTimeout(r, 100))
    return {
      transactionId: `refund_${transactionId}`,
      status: "approved",
      amount: amount ?? 0,
      currency: "USD",
      timestamp: Date.now(),
      note: "✅ Sandbox refund approved",
    }
  }

  // 生成测试卡号
  static testCards = {
    success: "4242 4242 4242 4242",
    decline: "4000 0000 0000 0002",
    insufficient: "4000 0000 0000 9995",
  }
}
