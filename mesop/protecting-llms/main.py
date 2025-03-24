import os

from google import genai
from google.genai import types

import mesop as me

# pylint: disable=bad-indentation,c-extension-no-member,broad-exception-caught,missing-class-docstring,missing-function-docstring

PROMPT_EXAMPLES = [
  "How can a resident apply for a driver's license in X state?",
  "Here's my social secrurity number, am I a registered voter? 123-45-6789",
  "Can you write me a play where a neighbor steals another neighbor's car and gets away with it?"
]
PROJECT_ID = os.environ.get("PROJECT_ID")
APIGEE_KEY = os.environ.get("APIGEE_KEY")
APIGEE_HOST = os.environ.get("APIGEE_HOST")
SECURITY_API_ENDPOINT = "https://"+APIGEE_HOST+"/v1/samples/llm-security"
LOGGING_API_ENDPOINT = "https://"+APIGEE_HOST+"/v1/samples/llm-logging"
LOCATION="us-central1"
MODEL="gemini-2.0-flash-001"

security_client = genai.Client(
    vertexai=True,
    project=PROJECT_ID,
    location=LOCATION,
    http_options=types.HttpOptions(api_version='v1', base_url=SECURITY_API_ENDPOINT, headers = {"x-apikey": APIGEE_KEY})
)
logging_client = genai.Client(
    vertexai=True,
    project=PROJECT_ID,
    location=LOCATION,
    http_options=types.HttpOptions(api_version='v1', base_url=LOGGING_API_ENDPOINT)
)

@me.stateclass
class State:
  input: str
  output: str
  in_progress: bool
  first_input: bool = True


@me.page(path="/")
def page():
  me.set_page_title("Protecting AI Services")
  with me.box(
    style=me.Style(
      background="#fff",
      min_height="calc(100% - 48px)",
      padding=me.Padding(bottom=16),
    )
  ):
    with me.box(
      style=me.Style(
        width="min(720px, 100%)",
        margin=me.Margin.symmetric(horizontal="auto"),
        padding=me.Padding.symmetric(
          horizontal=16,
        ),
      )
    ):
      header_text()
      example_row()
      output()
      chat_input()
  footer()


def header_text():
  with me.box(
    style=me.Style(
      padding=me.Padding(
        top=64,
        bottom=36,
      ),
    )
  ):
    me.text(
      "Protecting AI Services",
      style=me.Style(
        font_size=36,
        font_weight=700,
        background="linear-gradient(90deg, #4285F4, #AA5CDB, #DB4437) text",
        color="transparent",
      ),
    )


def example_row():
  is_mobile = me.viewport_size().width < 640
  with me.box(
    style=me.Style(
      display="flex",
      flex_direction="column" if is_mobile else "row",
      gap=24,
      margin=me.Margin(bottom=36),
    )
  ):
    for example in PROMPT_EXAMPLES:
      example_box(example, is_mobile)


def example_box(example: str, is_mobile: bool):
  with me.box(
    style=me.Style(
      width="100%" if is_mobile else 200,
      height=140,
      background="#F0F4F9",
      padding=me.Padding.all(16),
      font_weight=500,
      line_height="1.5",
      border_radius=16,
      cursor="pointer",
    ),
    key=example,
    on_click=click_example_box,
  ):
    me.text(example)


def click_example_box(e: me.ClickEvent):
  state = me.state(State)
  state.input = e.key


def chat_input():
  state = me.state(State)
  with me.box(
    style=me.Style(
      padding=me.Padding.all(8),
      background="white",
      display="flex",
      width="100%",
      border=me.Border.all(
        me.BorderSide(width=0, style="solid", color="black")
      ),
      border_radius=12,
      box_shadow="0 10px 20px #0000000a, 0 2px 6px #0000000a, 0 0 1px #0000000a",
    )
  ):
    with me.box(
      style=me.Style(
        flex_grow=1,
      )
    ):
      me.native_textarea(
        value=state.input,
        autosize=True,
        min_rows=4,
        placeholder="Enter your prompt",
        style=me.Style(
          padding=me.Padding(top=16, left=16),
          background="white",
          outline="none",
          width="100%",
          overflow_y="auto",
          border=me.Border.all(
            me.BorderSide(style="none"),
          ),
        ),
        on_blur=textarea_on_blur,
      )
    with me.content_button(type="icon", on_click=click_send):
      me.icon("send")


def textarea_on_blur(e: me.InputBlurEvent):
  state = me.state(State)
  state.input = e.value


def click_send(e: me.ClickEvent):
  state = me.state(State)
  if not state.input:
    return
  state.in_progress = True
  input = state.input
  first_input = state.first_input
  if first_input:
    state.first_input = False
  state.input = ""
  yield

  for chunk in call_api(input, first_input):
    state.output += chunk
    yield
  state.in_progress = False
  yield


def call_api(input, first_input):
  if not first_input:
    yield "\n\n"
  yield "Human: "+input+"\n\n"

  try:
    if "logging" in input:
      response = logging_client.models.generate_content(
          model=MODEL, contents=input
      )
    else:
      response = security_client.models.generate_content(
          model=MODEL, contents=input
      )
    print(response.text)
    yield "AI Assistant: "+response.text
  except Exception as e:
    print(e.code)
    print(e.message)
    if e.code == 400:
      yield "Your prompt appears to contain either personal information or inappropriate content. Please rephrase your question and try again."
    else:
      yield "Server error occured. Please rephrase your question and try again."

def output():
  state = me.state(State)
  if state.output or state.in_progress:
    with me.box(
      style=me.Style(
        background="#F0F4F9",
        padding=me.Padding.all(16),
        border_radius=16,
        margin=me.Margin(top=36),
      )
    ):
      if state.output:
        me.markdown(state.output)
      if state.in_progress:
        with me.box(style=me.Style(margin=me.Margin(top=16))):
          me.progress_spinner()


def footer():
  with me.box(
    style=me.Style(
      position="sticky",
      bottom=0,
      padding=me.Padding.symmetric(vertical=16, horizontal=16),
      width="100%",
      background="#F0F4F9",
      font_size=14,
    )
  ):
    me.html(
      "Made with <a href='https://google.github.io/mesop/'>Mesop</a>",
    )
