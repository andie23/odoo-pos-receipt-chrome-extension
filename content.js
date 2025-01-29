const RECEIPT_SCREEN_CLASS = 'pos-receipt'
const FISCALPY_PRINT_UI_ID = 'fiscalpy-print-ui'
const FISCALPY_PRINT_BTN_ID = 'fiscalpy-print-btn'
const LOCAL_STORAGE_PAYMENT_FISCALPY = 'com.fiscalpy.odoo.extension.payment_types'
const LOCAL_STORAGE_CAN_PRINT_ONLOAD = 'com.fiscalpy.odoo.extension.can_print_onload'
const LOCAL_STORAGE_PRINTED_ORDER_NUMBERS = 'com.fiscalpy.odoo.extension.printed_order_numbers'

/**
 * Listen for messages from the background script
 */
chrome.runtime.onMessage.addListener((message) => {
    if (message.origin.action === 'print-receipt') {
        // Print went through successfully
        if (message.ok) updateOrderNumber(message.origin.receipt.order_number)

        // Print failed
        if (message.error) alert(message.error)
    }
})

function injectDownloadOption(params) {
    // if it's there, don't add it again
    if (document.getElementById(FISCALPY_PRINT_UI_ID)) return
    const htmlDownload = `
        <div id="${FISCALPY_PRINT_UI_ID}" class='d-flex gap-1'>
            <button
                disabled
                id="${FISCALPY_PRINT_BTN_ID}"
                class='button print btn btn-lg w-100 py-3'
                style='color: white; background-color: #115027;'>
                Print Fiscal Receipt (MRA)
            </button>
        </div>`;
    const receiptSpaceNode = document.getElementsByClassName('buttons')[0];
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

// Parse the receipt screen and extract the necessary data
function parseReceipt(node) {
    const receiptText = (node?.innerText ?? '').replace(/\s+/g, ' ')
    // We need to track the following aggregates for validation purposes..
    const aggregates = {
        "without_tax_code": 0,
        "calculated_total_quantity": 0,
        "calculated_sub_total_by_product": 0,
        "calculated_sub_total_by_payment_modes": 0,
        "calculated_total_products": 0,
        "sub_total": parseFloat(
            (receiptText.match(/Sub\s+Total\s+((([1-9]\d{0,2}(,\d{3})*)|0)?\.\d{2})/i)?.[1] ?? '0.0')
            .replace(',','')
        ).toFixed(2),
        "total_quantity": parseInt(
            receiptText.match(/Total\s+Product\s+Qty\s+(\d+)/i)?.[1] ?? '0'
        ),
        "total_products": parseInt(
            receiptText.match(/Total\s+No.\s+of\s+Products\s+(\d+)/i)?.[1] ?? '0'
        )
    }
    const contactSectionText = node.querySelector('.pos-receipt-contact')?.innerText ?? ''

    // Final receipt object that will be printed
    const receiptObj = {
        "user": contactSectionText.match(/Served\s+by\s+(\w+\s*(?:\w+))/i)?.[1] ?? 'N/A',
        "order_number": contactSectionText.match(/order (\d{5}-\d{3}-\d{4})/i)?.[1] ?? 'N/A',
        "products": (() => {
            const orders = []
            let taxCode = ''
            let productName = ''
            let productPrice = 0
            let productQuantity = 0
            const orderNodes = node.querySelector('.orderlines')

            for(let i=0;i < orderNodes.children.length; ++i) {
                child = orderNodes.children[i]
                if (child.classList.contains('responsive-price')) {
                    productName = `${child.innerText}`.trim()
                } else if(child.tagName === 'DIV' && !productName && /^[\w\s]+$/i.test(child.innerHTML)) {
                    productName = `${child.innerText}`.trim()
                } else if (child.tagName === 'SPAN' && productName && !(productPrice && productQuantity)) {
                    productName = `${productName} ${child.innerText}`.trim()
                } else if (/price_display/i.test(child.innerHTML) && productName && !(productPrice && productQuantity)) {
                    const [priceQuantity, priceAndTaxCode] = child.innerText.split('\n')
                    const [quantity, price] = priceQuantity.split(' x ')

                    taxCode = priceAndTaxCode.match(/([ABE]{1}$)/i)?.[0]
                    productQuantity = parseInt(quantity)
                    productPrice = parseFloat(price.replace(',','')).toFixed(2)
                    orders.push({
                        "quantity": productQuantity,
                        "price": productPrice,
                        "name": productName,
                        "tax_code": taxCode
                    })

                    // Update aggregates after successfully identifying all product attributes
                    aggregates.calculated_sub_total_by_product += productPrice * productQuantity
                    aggregates.calculated_total_quantity += productQuantity
                    aggregates.calculated_total_products += 1
                    if (productPrice && !taxCode) aggregates.without_tax_code += 1
                    // Clear for next products to be iterated on
                    taxCode = ''
                    productPrice = 0
                    productQuantity = 0
                    productName = ''
                }
            }
            return orders
        })(),
        "payment_modes": (() => {
            // Preconfigured supported payment types
            const paymentTypes = getPaymentModes()
            return Object.keys(paymentTypes).reduce((acc, key) => { 
                const pattern = `${key}\\s*((([1-9]\\d{0,2}(,\\d{3})*)|0)?\\.\\d{2})`
                const found = receiptText.match(new RegExp(pattern, 'i'))
                if (found) {
                    acc[paymentTypes[key]] = parseFloat(found[1].replace(',','')).toFixed(2)
                    aggregates.calculated_sub_total_by_payment_modes += acc[paymentTypes[key]]
                }
                return acc
            }, {})
        })()
    }
    let validations = {}
    try {
        validations = {
            "Missing products": receiptObj.products.length === 0,
            "Missing total quantity": aggregates.total_quantity === 0,
            "Missing Order Number": !receiptObj.order_number,
            "Missing sub total": aggregates.sub_total === '0.0' || !aggregates.sub_total || isNaN(aggregates.sub_total) || aggregates.sub_total === 0,
            "Tax Code Missing": aggregates.without_tax_code > 0,
            "Invalid Sub Total": parseInt(aggregates.sub_total) !== parseInt(aggregates.calculated_sub_total_by_product),
            "Invalid Total Quantity": aggregates.total_quantity !== aggregates.calculated_total_quantity,
            "Payment Mismatch": parseInt(aggregates.calculated_sub_total_by_payment_modes) < parseInt(aggregates.sub_total),
            "Invalid Total Products": parseInt(aggregates.total_products) !== parseInt(aggregates.calculated_total_products)
        }
    } catch (e) {
        validations = {
            "Receipt validation has crashed!": true
        }
        console.error(e)
    }
    return {
        receiptData: receiptObj,
        aggregates,
        errors: Object.keys(validations).filter(key => validations[key])
    }
}

function isOrderNumberPrinted(orderNumber) {
    const orderNumbers = JSON.parse(localStorage.getItem(LOCAL_STORAGE_PRINTED_ORDER_NUMBERS) ?? '[]')
    return orderNumbers && orderNumbers.includes(orderNumber)
}

function updateOrderNumber(orderNumber) {
    const orderNumbers = JSON.parse(localStorage.getItem(LOCAL_STORAGE_PRINTED_ORDER_NUMBERS) ?? '[]')
    orderNumbers.push(orderNumber)
    localStorage.setItem(LOCAL_STORAGE_PRINTED_ORDER_NUMBERS, JSON.stringify(orderNumbers))
}

function getPaymentModes() {
    let paymentTypes = localStorage.getItem(LOCAL_STORAGE_PAYMENT_FISCALPY)
    if (!paymentTypes) {
        localStorage.setItem(LOCAL_STORAGE_PAYMENT_FISCALPY, '{"Cash": "P", "Card": "N"}')
    }
    return JSON.parse(paymentTypes)
}

function init(node) {
    const receipt = parseReceipt(node)
    console.log(receipt)
    const sendPrintMessage = () => {
        if (isOrderNumberPrinted(receipt.receiptData.order_number)) {
            if (!confirm(`Order number ${receipt.receiptData.order_number} was already processed. YOU MAY INCUR DOUBLE TAXATION IF YOU PRINT AGAIN...`)) {
                return
            }
        }
        chrome.runtime.sendMessage({ receipt: receipt.receiptData, action: "print-receipt" })
    }
    if (receipt.errors.length > 0) {
        return alert(`Receipt Extraction Failed: ${receipt.errors.join(', ')}`)
    }
    if (localStorage.getItem(LOCAL_STORAGE_CAN_PRINT_ONLOAD) === 'true') { 
        sendPrintMessage()
    }
    injectDownloadOption({
        onPrint: () => sendPrintMessage()
    })
}

/*
* Entry point
*/
window.addEventListener('load', () => {
    const container = document.getElementsByClassName(RECEIPT_SCREEN_CLASS)[0]
    if (container) init(container)
    // Observe for new receipt screens
    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            // A new receipt screen has been added
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList.contains(RECEIPT_SCREEN_CLASS)) {
                        init(node)
                    }
                });
            }
        }
    });
    // Start observing the target node for configured mutations
    observer.observe(document.body, {
        childList: true, // Observe direct children
        attributes: true, // Observe attribute changes (like class)
        subtree: true, // Observe all descendants
    });
})