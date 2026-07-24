import { BrandedPayCheckout } from "@/components/pay/branded-pay-checkout"

export default async function BrandedPayPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <BrandedPayCheckout token={token} />
}
