export async function readJsonResponse(response) {
  if (!response || typeof response.text !== "function") {
    return {
      value: null,
      parsed: false,
      empty: true,
    };
  }

  const text = await response.text();
  if (typeof text !== "string" || text.trim().length === 0) {
    return {
      value: null,
      parsed: false,
      empty: true,
    };
  }

  try {
    return {
      value: JSON.parse(text),
      parsed: true,
      empty: false,
    };
  } catch (error) {
    return {
      value: null,
      parsed: false,
      empty: false,
      error,
    };
  }
}