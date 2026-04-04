export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? 0;
    this.payload = options.payload ?? null;
  }
}

function buildInit(method, body, headers) {
  const init = {
    method,
    credentials: "include",
    headers: {
      ...(headers || {})
    }
  };

  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  return init;
}

function buildFormInit(method, formData) {
  return {
    method,
    credentials: "include",
    body: formData,
  };
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return null;
}

export function createApiClient({ baseUrl = "" } = {}) {
  async function request(path, options = {}) {
    const response = await fetch(
      `${baseUrl}${path}`,
      buildInit(options.method || "GET", options.body, options.headers)
    );

    const payload = await parseResponse(response);

    if (!response.ok || !payload || payload.ok === false) {
      const message = payload?.error?.message || payload?.message || "API request failed.";
      throw new ApiError(message, {
        status: response.status,
        payload
      });
    }

    return payload;
  }

  return {
    request,
    get(path, options = {}) {
      return request(path, { ...options, method: "GET" });
    },
    post(path, body, options = {}) {
      return request(path, { ...options, method: "POST", body });
    },
    put(path, body, options = {}) {
      return request(path, { ...options, method: "PUT", body });
    },
    patch(path, body, options = {}) {
      return request(path, { ...options, method: "PATCH", body });
    },
    delete(path, body, options = {}) {
      return request(path, { ...options, method: "DELETE", body });
    },
    async postForm(path, formData) {
      const response = await fetch(`${baseUrl}${path}`, buildFormInit("POST", formData));
      const payload = await parseResponse(response);
      if (!response.ok || !payload || payload.ok === false) {
        const message = payload?.error?.message || payload?.message || "API request failed.";
        throw new ApiError(message, { status: response.status, payload });
      }
      return payload;
    }
  };
}