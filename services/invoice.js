function generateOrderNumber() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(100 + Math.random() * 900);
  return `PO-${date}-${rand}`;
}

function buildInvoice(account, order) {
  return {
    orderNumber: generateOrderNumber(),
    date: new Date().toLocaleString(),
    account,
    items: order.items,
    total: order.total,
    paymentTerms: 'Net 30 days'
  };
}

module.exports = { buildInvoice };
