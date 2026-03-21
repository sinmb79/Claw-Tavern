export function createIdentitySessionHandlers(deps = {}) {
  void deps;

  return {
    async onRequestGet(context) {
      throw new Error("not implemented");
    },

    async onRequestPost(context) {
      throw new Error("not implemented");
    },

    async onRequestDelete(context) {
      throw new Error("not implemented");
    }
  };
}

const handlers = createIdentitySessionHandlers();

export const onRequestGet = handlers.onRequestGet;
export const onRequestPost = handlers.onRequestPost;
export const onRequestDelete = handlers.onRequestDelete;
