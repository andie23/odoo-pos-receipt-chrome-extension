const RECEIPT_SCREEN_CLASS = 'pos-receipt'
const FISCALPY_PRINT_UI_ID = 'fiscalpy-print-ui'
const FISCALPY_PRINT_BTN_ID = 'fiscalpy-print-btn'

function extractMoney(text) {
    return (text??'').match(/((([1-9]\d{0,2}(,\d{3})*)|0)?\.\d{2})\s+MK/i)?.[1] ?? -1
}

function injectDownloadOption(params) {
    const htmlDownload = `
        <div id="${FISCALPY_PRINT_UI_ID}" class='d-flex gap-1'>
            <button
                disabled
                id="${FISCALPY_PRINT_BTN_ID}"
                class='button print btn btn-lg w-100 py-3'
                style='color: white; background-color: #115027;'>
                Print Fiscal Receipt (MRA)
            </button>
        </div>
    `;
    const receiptSpaceNode = document.getElementsByClassName('receipt-options')[0];
    receiptSpaceNode.insertAdjacentHTML('afterbegin', htmlDownload);
    setTimeout(() => {
        document.getElementById(FISCALPY_PRINT_BTN_ID).removeAttribute('disabled');
        document.getElementById(FISCALPY_PRINT_BTN_ID).addEventListener('click', () => {
            if (typeof params.onPrint === 'function') {
                params.onPrint()
            }
        });
    }, 500)
}

function parseReceipt(node) {
    const receiptObj = {
        "order_number": (() => {
            const text = node.querySelector('.pos-receipt-order-data')?.innerText ?? ''
            return text.match(/Order\s+(\d{5}-\d{3}-\d{4})/i)?.[1] ?? "N/A"
        })(),
        "user": (() => {
            const text = node.querySelector('.cashier')?.innerText ?? ''
            return text.match(/Served\s+by\s+(\w+)/i)?.[1] ?? 'N/A'
        })(),
        "products": (() => {
            const orders = []
            const orderNodes = node.querySelectorAll('.orderline')
            for (let i=0; i < orderNodes.length; ++i) {
                const oNode = orderNodes[i]
                const product = {
                    "tax_code": "E",
                    "name": oNode.querySelector('.product-name')?.innerText ?? '',
                    "quantity": parseInt(`${oNode.querySelector('.qty')?.innerText??'-1'}`),
                    "price": extractMoney(
                        oNode.querySelector('.price-per-unit')?.innerText
                    )
                }
                orders.push(product)
            }
            return orders
        })(),
        "payment_modes": (() => {
            const payments = {}
            const paymentNodes = node.querySelectorAll('.paymentlines')??[]
            for (let i = 0; i < paymentNodes.length; ++i) {
                const [paymentMethod, amountPaid] = `${paymentNodes[i].innerText??''}`.split('\n')
                payments[paymentMethod] = extractMoney(amountPaid)
            }
            return payments
        })(),
        "total_amount": extractMoney(
            node.querySelector('.pos-receipt-amount')?.innerText
        )
    }
    return receiptObj
}

// Create a MutationObserver
const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
        if (mutation.type === 'childList') {
            // Check for added nodes
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.classList.contains(RECEIPT_SCREEN_CLASS)) {
                    const receipt = parseReceipt(node)
                    injectDownloadOption({
                        onPrint: () => {
                            console.log(receipt)
                            chrome.runtime.sendMessage({
                                action: "print-receipt", receipt
                            })
                        }
                    })
                }
            });
        }
    }
});

// Start observing the entire document or a specific container
observer.observe(document.body,{
    childList: true, // Observe direct children
    attributes: true, // Observe attribute changes (like class)
    subtree: true, // Observe all descendants
});