
import { api, unwrap } from "./client";

export const create = (formData) => api.post("/services", formData).then(unwrap);

export const update = (serviceId, formData) =>
  api.put(`/services/${serviceId}`, formData).then(unwrap);


export const remove = (serviceId) =>
  api.delete(`/services/${serviceId}`).then((res) => ({
    ...unwrap(res),
    message: res.data.message,
  }));
