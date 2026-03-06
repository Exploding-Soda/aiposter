# 如何 curl 通 Cherry 的模型

## 基本信息

- Base URL: `https://open.cherryin.net/v1`
- API Key: `sk-kzxdrvYRQEs0vWL3DT9g57BS2GfhdnbOFsqys9Y0zESQxidi`

认证头：

```bash
Authorization: Bearer <API_KEY>
```

## 1. 文本模型

模型：

`google/gemini-3-flash-preview`

```bash
curl https://open.cherryin.net/v1/chat/completions \
  -H "Authorization: Bearer sk-kzxdrvYRQEs0vWL3DT9g57BS2GfhdnbOFsqys9Y0zESQxidi" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-3-flash-preview",
    "messages": [
      {
        "role": "user",
        "content": "Reply with exactly OK"
      }
    ],
    "temperature": 0
  }'
```

## 2. 带图输入的文本模型

先把图片转成 base64 data url，再放进 `image_url.url`。

```bash
curl https://open.cherryin.net/v1/chat/completions \
  -H "Authorization: Bearer sk-kzxdrvYRQEs0vWL3DT9g57BS2GfhdnbOFsqys9Y0zESQxidi" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-3-flash-preview",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "Describe this image in one short sentence."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/png;base64,..."
            }
          }
        ]
      }
    ],
    "temperature": 0
  }'
```

## 3. 图像模型

模型：

`google/gemini-3.1-flash-image-preview`

```bash
curl https://open.cherryin.net/v1/chat/completions \
  -H "Authorization: Bearer sk-kzxdrvYRQEs0vWL3DT9g57BS2GfhdnbOFsqys9Y0zESQxidi" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-3.1-flash-image-preview",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "Use this image as reference."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/png;base64,..."
            }
          }
        ]
      }
    ],
    "temperature": 0.2
  }'
```

## 注意

- 用 `google/...` 模型名，不要只写 `gemini-3-flash-preview`
- 当前验证通过的是 `/v1/chat/completions`
- Cherry 的 `/v1/images/generations` 和 `/v1/images/edits` 对这个图像模型不稳定，不建议用
