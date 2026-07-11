// Singleton store holding the customer selected in the admin dashboard's
// Customer Admin picker (AdminCustomerPanel). AIAgent is mounted outside
// Dashboard's component tree (see App.js), so this module bridges the two
// without threading React context through the app shell.
let selected = null; // { id, name } | null

export const adminCustomerContext = {
  get() {
    return selected;
  },
  set(customer) {
    selected = customer;
  },
};
