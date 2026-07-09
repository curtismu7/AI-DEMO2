module.exports = {
  post: jest.fn(),
  get: jest.fn(),
  create: jest.fn(function axiosCreate() {
    return { post: jest.fn(), get: jest.fn(), defaults: { headers: {} } };
  }),
};
