import academy/icons
import academy/meta
import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import gleam/uri
import lustre
import lustre/attribute.{attribute, class}
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html
import lustre/element/keyed
import lustre/element/svg
import lustre/event
import modem
import rsvp

const base_url = "http://localhost:8800"

pub fn main() {
  let app = lustre.application(init, update, view)
  let assert Ok(_) = lustre.start(app, "#app", Nil)

  Nil
}

type Route {
  Threads
  Thread(ModmailThread)
  Cases
  Case(id: Int)
  Stats
  Issues
  InterviewQuestions
  NotFound(path: List(String))
}

type Trainee {
  Trainee(
    id: String,
    name: String,
    thread_participation_count: Int,
    message_count: Int,
    issue_count: Int,
  )
}

type ThreadMsgKind {
  InternalMsg
  IncomingMsg
  OutgoingMsg
  SystemMsg
}

type ThreadRole {
  TraineeRole
  ModRole
  HelperRole
  AdminRole
  SystemRole
  UserRole
}

type ThreadMsg {
  ThreadMsg(
    kind: ThreadMsgKind,
    role: ThreadRole,
    user_id: String,
    user_name: String,
    content: String,
    time: String,
  )
}

type ModmailThread {
  ModmailThread(
    id: String,
    open: Bool,
    user_messages: Int,
    reply_messages: Int,
    internal_messages: Int,
    participant_ids: List(String),
    username: String,
    messages: List(ThreadMsg),
  )
}

type UserRole {
  AdminUser
  HelperUser
  ModUser
  TraineeUser
  UnknownUser
}

fn user_role_decoder() -> decode.Decoder(UserRole) {
  use variant <- decode.then(decode.string)
  case variant {
    "admin" -> decode.success(AdminUser)
    "helper" -> decode.success(HelperUser)
    "mod" -> decode.success(ModUser)
    "trainee" -> decode.success(TraineeUser)
    _ -> decode.failure(UnknownUser, "UserRole")
  }
}

type User {
  User(
    logged_in: Bool,
    id: String,
    display_name: String,
    avatar: String,
    role: UserRole,
  )
}

fn user_decoder() -> decode.Decoder(User) {
  use id <- decode.field("id", decode.string)
  use display_name <- decode.field("display_name", decode.string)
  use avatar <- decode.field("avatar_url", decode.string)
  use role <- decode.field("role", user_role_decoder())
  decode.success(User(logged_in: True, id:, display_name:, avatar:, role:))
}

type Model {
  Model(
    route: Route,
    wave: String,
    loading: Bool,
    user: User,
    issues: List(String),
    trainees: List(Trainee),
    threads: List(ModmailThread),
    total_cases: Int,
    total_threads: Int,
    total_issues: Int,
    cases: List(String),
    // Interview stuff
    interview_questions: List(String),
    // Thread filtering
    thread_filter: String,
    threads_open: Bool,
    threads_closed: Bool,
    thread_trainee: Option(String),
  )
}

fn init(_) -> #(Model, Effect(Message)) {
  let route =
    modem.initial_uri()
    |> result.map(fn(uri) { uri.path_segments(uri.path) })
    |> fn(path) {
      case path {
        Ok([]) | Ok(["academy"]) | Ok(["academy", "threads"]) -> Threads
        Ok(["academy", "threads", id]) ->
          Thread(
            ModmailThread(
              id:,
              open: True,
              user_messages: 1,
              reply_messages: 32,
              internal_messages: 100,
              participant_ids: [],
              username: "pisswaddle",
              messages: [
                ThreadMsg(
                  kind: IncomingMsg,
                  role: UserRole,
                  user_id: "0",
                  user_name: "pisswaddle",
                  content: "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, ",
                  time: "",
                ),
              ],
            ),
          )

        Ok(["academy", "cases"]) -> Cases

        Ok(["academy", "questions"]) -> InterviewQuestions

        Ok(["academy", "cases", id] as path) ->
          case int.parse(id) {
            Ok(id) -> Case(id)
            _ -> NotFound(path)
          }

        Ok(["academy", "stats"]) -> Stats

        Ok(["academy", "issues"]) -> Issues

        _ -> NotFound(result.unwrap(path, []))
      }
    }

  #(
    Model(
      route:,
      loading: False,
      wave: "2026 — June",
      cases: [],
      user: User(
        logged_in: True,
        id: "",
        display_name: "Isaac",
        avatar: "https://cdn.discordapp.com/guilds/94882524378968064/users/204084691425427466/avatars/98bdb0a9854cc0da563f51b6a300a98b.png?size=512",
        role: UnknownUser,
      ),
      issues: [
        "Bleh",
        "Bleh",
        "Bleh",
        "Bleh",
      ],
      threads: [
        ModmailThread(
          id: "ed381ca7-5a8b-4546-9bdd-247ec0531ebc",
          open: True,
          user_messages: 3,
          reply_messages: 10,
          internal_messages: 4000,
          participant_ids: ["123", "123", "123"],
          username: "au.ra",
          messages: [],
        ),
      ],
      trainees: [
        Trainee(
          id: "164564849915985922",
          name: "Dray",
          thread_participation_count: 12,
          message_count: 100,
          issue_count: 2,
        ),
        Trainee(
          id: "204084691425427466",
          name: "Isaac",
          thread_participation_count: 12,
          message_count: 100,
          issue_count: 2,
        ),
      ],
      interview_questions: [],
      total_cases: 0,
      total_threads: 0,
      total_issues: 0,
      thread_filter: "",
      threads_open: True,
      threads_closed: True,
      thread_trainee: None,
    ),
    effect.batch([modem.init(on_url_change), get_user(), route_effects(route)]),
  )
}

type Message {
  OnRouteChange(Route)

  // Api returning
  ApiReturnedUser(Result(User, rsvp.Error(String)))

  ApiReturnedQuestions(Result(List(String), rsvp.Error(String)))

  // User initiated actions
  UserChangedThreadOpenFilter(Bool)

  UserChangedThreadClosedFilter(Bool)

  UserChangedThreadTraineeFilter(String)

  UserWroteThreadFilter(String)
}

fn on_url_change(uri: uri.Uri) -> Message {
  case uri.path_segments(uri.path) {
    ["academy"] | ["academy", "threads"] -> OnRouteChange(Threads)

    ["academy", "threads", id] ->
      OnRouteChange(
        Thread(
          ModmailThread(
            id:,
            open: True,
            user_messages: 1,
            reply_messages: 32,
            internal_messages: 100,
            participant_ids: [],
            username: "pisswaddle",
            messages: [
              ThreadMsg(
                kind: IncomingMsg,
                role: UserRole,
                user_id: "0",
                user_name: "pisswaddle",
                content: "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, ",
                time: "",
              ),
              ThreadMsg(
                kind: OutgoingMsg,
                role: ModRole,
                user_id: "0",
                user_name: "dray",
                content: "are you pilo, tamni?",
                time: "",
              ),
            ],
          ),
        ),
      )

    ["academy", "stats"] -> OnRouteChange(Stats)

    ["academy", "issues"] -> OnRouteChange(Issues)

    ["academy", "cases"] -> OnRouteChange(Cases)

    ["academy", "questions"] -> OnRouteChange(InterviewQuestions)

    ["academy", "cases", id] as path ->
      case int.parse(id) {
        Ok(id) -> OnRouteChange(Case(id))
        _ -> OnRouteChange(NotFound(path))
      }
    path -> OnRouteChange(NotFound(path))
  }
}

fn update(model: Model, message: Message) -> #(Model, Effect(Message)) {
  case message {
    OnRouteChange(route) -> #(Model(..model, route:), route_effects(route))

    ApiReturnedUser(Ok(user)) -> #(Model(..model, user: user), effect.none())

    ApiReturnedUser(err) -> {
      echo err
      #(model, effect.none())
    }

    ApiReturnedQuestions(Ok(interview_questions)) -> #(
      Model(..model, interview_questions:),
      effect.none(),
    )

    ApiReturnedQuestions(err) -> {
      echo err
      #(model, effect.none())
    }

    UserChangedThreadOpenFilter(state) -> #(
      Model(..model, threads_open: state),
      effect.none(),
    )

    UserChangedThreadClosedFilter(state) -> #(
      Model(..model, threads_closed: state),
      effect.none(),
    )

    UserChangedThreadTraineeFilter("") -> #(
      Model(..model, thread_trainee: None),
      effect.none(),
    )

    UserChangedThreadTraineeFilter(trainee) -> #(
      Model(..model, thread_trainee: Some(trainee)),
      effect.none(),
    )

    UserWroteThreadFilter(filter) -> #(
      Model(..model, thread_filter: filter),
      effect.none(),
    )
  }
}

fn view(model: Model) -> Element(Message) {
  html.div([class("grid lg:grid-cols-12 h-[100dvh]")], [
    html.nav([class("lg:col-span-2 page-sidebar border-r border-gray-800")], [
      html.details([class("relative")], [
        html.summary([class("sidebar-logo")], [
          icons.mortarboard([]),
          html.div([], [
            html.h3([], [html.text("Academy")]),
            html.p([class("font-bold text-xs text-gray-400")], [
              html.text(model.wave),
            ]),
          ]),
          icons.chevron_down([class("size-4 ml-auto")]),
        ]),
        html.ul(
          [
            class(
              "absolute top-full left-3 right-3 bg-gray-900 border border-gray-800 rounded-lg p-1 z-50",
            ),
          ],
          [
            html.li([], [html.button([], [html.text("2026 — June")])]),
            html.li([], [html.button([], [html.text("2025 — December")])]),
            html.li([], [html.button([], [html.text("2023 — Jure")])]),
            html.li([], [html.button([], [html.text("2021 — Septober")])]),
          ],
        ),
      ]),
      html.ul([], [
        sidebar_link(model, Threads),
        sidebar_link(model, Cases),
        sidebar_link(model, Stats),
        sidebar_link(model, Issues),
        sidebar_link(model, InterviewQuestions),
      ]),
    ]),

    case model.route {
      Threads | Thread(_) -> threads_sidebar(model)
      Cases | Case(_) -> cases_sidebar(model)
      _ -> element.none()
    },

    html.main(
      [
        class(case model.route {
          Threads | Thread(_) | Cases | Case(_) -> "lg:col-span-7"
          _ -> "lg:col-span-10"
        }),
      ],
      [
        html.header(
          [
            class(
              "px-6 h-20 flex items-center justify-between flex-wrap border-b border-gray-900",
            ),
          ],
          [
            html.h1([class("font-bold text-xl text-white")], [
              html.text(case model.route {
                Threads -> "Threads"
                Thread(ModmailThread(username:, ..)) ->
                  "Thread with " <> username
                Cases -> "Cases"
                Case(id:) -> "Case #" <> int.to_string(id)
                Stats -> "Statistics"
                Issues -> "Issues"
                InterviewQuestions -> "Interview Questions"
                NotFound(_path) -> "Page Not Found"
              }),
            ]),
            html.nav([], [
              html.details([class("relative")], [
                html.summary(
                  [
                    class(
                      "flex items-center gap-3 font-semibold cursor-pointer rounded-md py-2 px-3 border border-transparent transition-colors hover:border-gray-800 hover:bg-gray-1000",
                    ),
                  ],
                  [
                    html.img([
                      attribute.src(model.user.avatar),
                      class("size-7 rounded-full"),
                    ]),
                    html.text(model.user.display_name),
                    icons.chevron_down([class("size-4")]),
                  ],
                ),
                html.ul([class("absolute top-full right-0 bg-black")], [
                  html.li([], [
                    html.a([attribute.href("/academy/logout")], [
                      html.text("Logout"),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ],
        ),

        case model.route {
          Thread(ModmailThread(messages:, ..)) ->
            html.ul(
              [class("p-6 grid gap-4")],
              list.map(messages, fn(message) {
                html.li([], [
                  html.h4(
                    [
                      class(
                        "font-bold "
                        <> case message.role {
                          ModRole | TraineeRole -> "text-ow-mod"
                          HelperRole -> "text-ow-helper"
                          AdminRole -> "text-ow-admin"
                          SystemRole -> ""
                          UserRole -> "text-white"
                        },
                      ),
                    ],
                    [
                      html.text(message.user_name),
                    ],
                  ),
                  html.p([], [
                    html.text(message.content),
                  ]),
                ])
              }),
            )

          Threads ->
            html.div([class("p-10 text-center text-gray-300 text-xl")], [
              html.text("Please select a thread"),
            ])

          Issues -> issues_view(model)

          Cases -> html.div([], [])

          Case(_) -> html.div([], [])

          Stats -> stats_view(model)

          InterviewQuestions ->
            questions_view(model.user, model.interview_questions)

          NotFound(_) -> html.div([], [])
        },
      ],
    ),
  ])
}

fn sidebar_link(model: Model, route: Route) {
  let #(icon, href, text) = case route {
    Threads -> #(icons.envelope([]), "/academy/threads", "Threads")

    Thread(ModmailThread(id:, ..)) -> #(
      icons.inbox([]),
      "/academy/thread/" <> id,
      "Thread",
    )

    Cases -> #(icons.cases([]), "/academy/cases", "Cases")

    Case(id:) -> #(
      icons.inbox([]),
      "/academy/case" <> int.to_string(id),
      "Case",
    )

    Stats -> #(icons.graph([]), "/academy/stats", "Statistics")

    Issues -> #(icons.issues([]), "/academy/issues", "Issues")

    InterviewQuestions -> #(
      icons.user_wave([]),
      "/academy/questions",
      "Interview Questions",
    )

    NotFound(_) -> #(icons.inbox([]), "/academy", "Unknown Link")
  }

  let active = case model.route, route {
    Threads, Threads | Thread(_), Threads -> True
    r1, r2 if r1 == r2 -> True
    _, _ -> False
  }

  html.li([attribute.classes([#("active", active)])], [
    html.a([attribute.href(href)], [
      icon,
      html.text(text),
    ]),
  ])
}

fn threads_sidebar(model: Model) {
  html.aside([class("lg:col-span-3 bg-gray-900 h-[100dvh] flex flex-col")], [
    html.header(
      [
        class("px-4 flex items-center h-20 border-b border-gray-800"),
      ],
      [
        html.form([attribute.action("#"), class("relative w-full")], [
          html.input([
            event.on_input(UserWroteThreadFilter),
            attribute.placeholder("Search thread user..."),
            class(
              "border border-gray-800 bg-gray-950 rounded-md py-1.5 px-4 w-full transition-colors outline-none",
            ),
          ]),
        ]),
      ],
    ),
    html.nav([class("filters p-4 flex gap-2 flex-wrap")], [
      html.button(
        [
          event.on_click(UserChangedThreadOpenFilter(!model.threads_open)),
          class(
            "bg-gray-800 rounded-sm py-1 px-3 font-semibold flex items-center gap-2 transition-all cursor-pointer hover:opacity-80 "
            <> case model.threads_open {
              True -> "bg-gray-800 text-gray-200"
              False -> "bg-gray-950 text-gray-400"
            },
          ),
        ],
        [
          icons.checkmark([
            class("transition-all size-5"),
            attribute.classes([#("-mr-6 opacity-0", !model.threads_open)]),
          ]),
          html.text("Open"),
        ],
      ),
      html.button(
        [
          event.on_click(UserChangedThreadClosedFilter(!model.threads_closed)),
          class(
            "bg-gray-800 rounded-sm py-1 px-3 font-semibold flex items-center gap-1 transition-all cursor-pointer hover:opacity-80 "
            <> case model.threads_closed {
              True -> "bg-gray-800 text-gray-200"
              False -> "bg-gray-950 text-gray-400"
            },
          ),
        ],
        [
          icons.checkmark([
            class("transition-all size-5"),
            attribute.classes([#("-mr-6 opacity-0", !model.threads_closed)]),
          ]),
          html.text("Closed"),
        ],
      ),
      html.select(
        [
          event.on_change(UserChangedThreadTraineeFilter),
          class(
            "bg-gray-800 rounded-sm py-1 px-3 font-semibold flex items-center gap-2 flex-1 transition-opacity cursor-pointer hover:opacity-80",
          ),
        ],
        [
          html.option([attribute.value("")], "Any Trainee"),
          ..list.map(model.trainees, fn(trainee) {
            html.option([attribute.value(trainee.id)], trainee.name)
          })
        ],
      ),
    ]),

    keyed.ul(
      [class("grid gap-2 px-4 overflow-y-auto flex-1 pb-6")],
      case filtered_threads(model) {
        [] -> [
          #(
            "0",
            html.li([class("text-center leading-loose p-6")], [
              html.text("Sorry, no threads match your criteria."),
            ]),
          ),
        ]
        threads ->
          list.map(threads, fn(thread) {
            #(
              thread.id,
              html.li([class("group")], [
                html.a(
                  [
                    attribute.href("/academy/threads/" <> thread.id),
                    class(
                      "block p-5 rounded-md bg-gray-950 border border-gray-800 border-l-4",
                    ),
                    attribute.classes([#("border-l-red-500", !thread.open)]),
                  ],
                  [
                    html.h4(
                      [class("font-bold mb-2 flex items-center gap-1.5")],
                      [
                        icons.hashtag([class("size-5 text-gray-400")]),
                        html.text(thread.username),
                      ],
                    ),
                    html.dl(
                      [
                        class(
                          "text-gray-300 text-sm flex items-end flex-wrap gap-4 font-semibold",
                        ),
                      ],
                      [
                        html.dd(
                          [
                            class("flex items-center gap-1.5"),
                            attribute.data("tooltip", "User Messages"),
                          ],
                          [
                            icons.arrow_in([class("size-5 text-gray-400")]),
                            html.text(int.to_string(thread.user_messages)),
                          ],
                        ),
                        html.dd(
                          [
                            class("flex items-center gap-1.5"),
                            attribute.data("tooltip", "Replies"),
                          ],
                          [
                            icons.arrow_out([
                              class("size-5 text-gray-400"),
                            ]),
                            html.text(int.to_string(thread.reply_messages)),
                          ],
                        ),
                        html.dd(
                          [
                            class("flex items-center gap-1.5"),
                            attribute.data("tooltip", "Internal Chat"),
                          ],
                          [
                            icons.message_bubbles([
                              class("size-5 text-gray-400"),
                            ]),
                            html.text(int.to_string(thread.internal_messages)),
                          ],
                        ),
                        html.dt([class("ml-auto")], [
                          html.div([class("flex")], [
                            html.figure(
                              [
                                class(
                                  "size-6 rounded-full bg-blue-400 border border-gray-800 -mr-2",
                                ),
                              ],
                              [],
                            ),
                            html.figure(
                              [
                                class(
                                  "size-6 rounded-full bg-green-400 border border-gray-800 -mr-2",
                                ),
                              ],
                              [],
                            ),
                            html.figure(
                              [
                                class(
                                  "size-6 rounded-full bg-orange-400 border border-gray-800",
                                ),
                              ],
                              [],
                            ),
                          ]),
                        ]),
                      ],
                    ),
                  ],
                ),
              ]),
            )
          })
      },
    ),
  ])
}

fn cases_sidebar(model: Model) {
  html.aside([class("lg:col-span-3 bg-gray-900 h-[100dvh] flex flex-col")], [
    html.header(
      [
        class("px-4 flex items-center h-20 border-b border-gray-800"),
      ],
      [
        html.form([attribute.action("#"), class("relative w-full")], [
          html.input([
            event.on_input(UserWroteThreadFilter),
            attribute.placeholder("Search case user..."),
            class(
              "border border-gray-800 bg-gray-950 rounded-md py-1.5 px-4 w-full transition-colors outline-none",
            ),
          ]),
        ]),
      ],
    ),
    html.nav([class("filters p-4 flex gap-2 flex-wrap")], [
      html.select(
        [
          event.on_change(UserChangedThreadTraineeFilter),
          class(
            "bg-gray-800 rounded-sm py-1 px-3 font-semibold flex items-center gap-2 flex-1 transition-opacity cursor-pointer hover:opacity-80",
          ),
        ],
        [
          html.option([attribute.value("")], "Any Case Type"),
          html.option([attribute.value("warns")], "Warns"),
          html.option([attribute.value("mutes")], "Mutes"),
          html.option([attribute.value("bans")], "Bans"),
        ],
      ),

      html.select(
        [
          event.on_change(UserChangedThreadTraineeFilter),
          class(
            "bg-gray-800 rounded-sm py-1 px-3 font-semibold flex items-center gap-2 flex-1 transition-opacity cursor-pointer hover:opacity-80",
          ),
        ],
        [
          html.option([attribute.value("")], "Any Trainee"),
          ..list.map(model.trainees, fn(trainee) {
            html.option([attribute.value(trainee.id)], trainee.name)
          })
        ],
      ),
    ]),

    keyed.ul(
      [class("grid gap-4 px-4")],
      list.index_map(model.cases, fn(issue, i) {
        #(
          "issue#" <> int.to_string(i),
          html.li([], [
            html.a(
              [
                attribute.href("/academy/issues/" <> int.to_string(i)),
                class(
                  "border border-gray-750 bg-gray-800 rounded border-l-3 border-l-case-blue py-2 px-3 grid gap-2",
                ),
              ],
              [
                html.h3([class("font-bold text-white")], [
                  html.text("Bad Modmail response"),
                ]),
                html.p([], [
                  html.text("Not comfortable with how this one went..."),
                ]),
                html.ul([class("flex gap-5 flex-wrap")], [
                  html.li([], [
                    html.h5([class("text-white font-semibold")], [
                      html.text("Reported by"),
                    ]),
                    html.p([], [
                      html.button(
                        [
                          class(
                            "px-1 py-0.5 rounded-md bg-tag-bg text-tag-fg leading-none",
                          ),
                        ],
                        [html.text("@graphiteisaac")],
                      ),
                    ]),
                  ]),

                  html.li([], [
                    html.h5([class("text-white font-semibold")], [
                      html.text("Trainee"),
                    ]),
                    html.p([], [
                      html.button(
                        [
                          class(
                            "px-1 py-0.5 rounded-md bg-tag-bg text-tag-fg leading-none",
                          ),
                        ],
                        [html.text("@poopsocket")],
                      ),
                    ]),
                  ]),
                ]),
                html.footer([class("text-sm")], [
                  html.p([], [
                    html.text("Created "),
                    html.time([class("bg-gray-750 rounded-sm px-1")], [
                      html.text("June 24th, 2026"),
                    ]),
                  ]),
                ]),
              ],
            ),
          ]),
        )
      }),
    ),
  ])
}

fn filtered_threads(model: Model) -> List(ModmailThread) {
  model.threads
  |> list.filter(fn(thread) {
    case model.thread_filter {
      "" -> True
      _ ->
        string.contains(
          string.lowercase(thread.username),
          string.lowercase(model.thread_filter),
        )
    }
  })
}

fn questions_view(user: User, questions: List(String)) {
  html.div([class("p-6 bg-gray-900")], [
    html.p(
      [
        class(
          "text-white border border-info-fg bg-info-bg rounded-md px-4 py-2 flex items-center gap-2 mb-8",
        ),
      ],
      [
        icons.info_circle([class("size-5 text-info-fg")]),
        html.text(
          "Clicking the question text will automatically copy-paste it into your clipboard, prefixed with !ar.",
        ),
        case user.role {
          AdminUser ->
            html.a(
              [
                attribute.href("/academy/edit-questions"),
                class(
                  "ml-auto bg-gray-800 rounded-md py-1 px-4 transition-colors cursor-pointer hover:bg-gray-750",
                ),
              ],
              [
                html.text("Edit"),
              ],
            )
          _ -> element.none()
        },
      ],
    ),
    case questions {
      [] ->
        html.div(
          [
            attribute.role("alert"),
            class(
              "text-white border border-orange-300 bg-orange-500/10 rounded-md px-4 py-2 flex items-center gap-2 mb-8",
            ),
          ],
          [
            icons.info_circle([class("size-5 text-orange-300")]),
            html.text("Loading interview questions..."),
          ],
        )
      _ ->
        keyed.ul(
          [class("grid gap-4")],
          list.index_map(questions, fn(question, i) {
            #(
              "question-" <> int.to_string(i),
              html.li(
                [
                  class(
                    "flex items-center px-4 py-5 bg-gray-800 border border-gray-750 rounded-lg",
                  ),
                ],
                [
                  html.input([
                    attribute.type_("checkbox"),
                    class("opacity-0 absolute"),
                  ]),
                  html.div(
                    [
                      attribute.class(
                        "bg-gray-800 border border-gray-750 p-1 rounded-md mr-4",
                      ),
                    ],
                    [
                      svg.svg(
                        [
                          attribute.class("size-5"),
                          attribute("stroke-linejoin", "round"),
                          attribute("stroke-linecap", "round"),
                          attribute("stroke-width", "3"),
                          attribute("stroke", "currentColor"),
                          attribute("fill", "none"),
                          attribute("viewBox", "0 0 24 24"),
                          attribute("xmlns", "http://www.w3.org/2000/svg"),
                        ],
                        [svg.path([attribute("d", "M20 6 9 17l-5-5")])],
                      ),
                    ],
                  ),
                  // html.p([attribute.class("question-num")], [
                  //   html.text("#" <> int.to_string(i + 1)),
                  // ]),
                  html.div([attribute.class("questions")], [
                    html.p(
                      [
                        attribute.class(
                          "question hover:underline cursor-pointer",
                        ),
                        attribute.attribute(
                          "onclick",
                          "window.navigator.clipboard.writeText(this.textContent)",
                        ),
                      ],
                      [
                        html.text(question),
                      ],
                    ),
                  ]),
                ],
              ),
            )
          }),
        )
    },
  ])
}

fn stats_view(model: Model) {
  html.section([class("grid lg:grid-cols-3 gap-8 p-6 bg-gray-900")], [
    html.article(
      [
        class(
          "bg-gray-800 border border-gray-750 rounded-xl p-8 flex items-center gap-8",
        ),
      ],
      [
        html.figure([class("p-4 rounded-lg bg-orange-500/10")], [
          icons.envelope([class("size-8 text-orange-300")]),
        ]),
        html.div([], [
          html.h1([class("text-3xl font-extrabold text-white")], [
            html.text(int.to_string(model.total_threads)),
          ]),
          html.h3([class("text-gray-300")], [
            html.text("Threads"),
          ]),
        ]),
      ],
    ),
    html.article(
      [
        class(
          "bg-gray-800 border border-gray-750 rounded-xl p-8 flex items-center gap-8",
        ),
      ],
      [
        html.figure([class("p-4 rounded-lg bg-blue-500/10")], [
          icons.cases([class("size-8 text-blue-300")]),
        ]),
        html.div([], [
          html.h1([class("text-3xl font-extrabold text-white")], [
            html.text(int.to_string(model.total_cases)),
          ]),
          html.h3([class("text-gray-300")], [
            html.text("Cases"),
          ]),
        ]),
      ],
    ),
    html.article(
      [
        class(
          "bg-gray-800 border border-gray-750 rounded-xl p-8 flex items-center gap-8",
        ),
      ],
      [
        html.figure([class("p-4 rounded-lg bg-rose-500/10")], [
          icons.issues([class("size-8 text-rose-300")]),
        ]),
        html.div([], [
          html.h1([class("text-3xl font-extrabold text-white")], [
            html.text(int.to_string(model.total_issues)),
          ]),
          html.h3([class("text-gray-300")], [
            html.text("Issues"),
          ]),
        ]),
      ],
    ),

    html.header([class("lg:col-span-3")], [
      html.h3([class("text-xl font-bold text-white")], [
        html.text("Trainees"),
      ]),
    ]),

    keyed.ul(
      [class("grid gap-4 lg:col-span-3")],
      list.map(model.trainees, fn(trainee) {
        #(
          "trainee#" <> trainee.id,
          html.li(
            [
              class(
                "rounded flex items-center gap-4 p-2 hover:bg-gray-800 transition-colors",
              ),
            ],
            [
              html.figure([class("size-14 rounded-full bg-black")], []),
              html.div([], [
                html.h3([class("font-semibold text-lg text-ow-mod")], [
                  html.text(trainee.name),
                ]),
                html.p([class("text-gray-300")], [
                  html.text(
                    int.to_string(trainee.message_count)
                    <> " messages, "
                    <> int.to_string(trainee.thread_participation_count)
                    <> " threads participated in, "
                    <> int.to_string(trainee.issue_count)
                    <> " issues",
                  ),
                ]),
              ]),
            ],
          ),
        )
      }),
    ),
  ])
}

fn issues_view(model: Model) {
  html.div([class("p-6 bg-gray-900")], [
    html.header([class("flex items-center justify-between gap-4 mb-8")], [
      html.h2([class("text-2xl text-gray-100")], [
        html.text(int.to_string(list.length(model.issues)) <> " issues found"),
      ]),
    ]),
    html.section([], [
      keyed.ul(
        [class("grid gap-4")],
        list.index_map(model.issues, fn(issue, i) {
          #(
            "issue#" <> int.to_string(i),
            html.li([], [
              html.a(
                [
                  attribute.href("/academy/issues/" <> int.to_string(i)),
                  class(
                    "block border border-gray-750 bg-gray-800 rounded border-l-3 border-l-case-blue py-4 px-5",
                  ),
                ],
                [
                  html.h3([class("font-bold text-white")], [
                    html.text("Bad Modmail response"),
                  ]),
                  html.p([], [
                    html.text("Not comfortable with how this one went..."),
                  ]),
                  // html.ul([class("flex gap-5 flex-wrap")], [
                //   html.li([], [
                //     html.h5([class("text-white font-semibold")], [
                //       html.text("Reported by"),
                //     ]),
                //     html.p([], [
                //       html.button(
                //         [
                //           class(
                //             "px-1 py-0.5 rounded-md bg-tag-bg text-tag-fg leading-none",
                //           ),
                //         ],
                //         [html.text("@graphiteisaac")],
                //       ),
                //     ]),
                //   ]),
                //
                //   html.li([], [
                //     html.h5([class("text-white font-semibold")], [
                //       html.text("Trainee"),
                //     ]),
                //     html.p([], [
                //       html.button(
                //         [
                //           class(
                //             "px-1 py-0.5 rounded-md bg-tag-bg text-tag-fg leading-none",
                //           ),
                //         ],
                //         [html.text("@poopsocket")],
                //       ),
                //     ]),
                //   ]),
                // ]),
                // html.footer([class("text-sm")], [
                //   html.p([], [
                //     html.text("Created "),
                //     html.time([class("bg-gray-750 rounded-sm px-1")], [
                //       html.text("June 24th, 2026"),
                //     ]),
                //   ]),
                // ]),
                ],
              ),
            ]),
          )
        }),
      ),
    ]),
  ])
}

// Data functions

fn get_user() {
  let handler = rsvp.expect_json(user_decoder(), ApiReturnedUser)
  rsvp.get(base_url <> "/academy/api/auth/me", handler)
}

fn get_questions() {
  let handler =
    rsvp.expect_json(decode.list(decode.string), ApiReturnedQuestions)
  rsvp.get(base_url <> "/academy/api/questions", handler)
}

// Other effects
fn set_title(route: Route) {
  let page_title = case route {
    Threads -> "Threads"
    Thread(ModmailThread(id:, ..)) -> "Thread #" <> id
    Cases -> "Cases"
    Case(id:) -> "Case #" <> int.to_string(id)
    Stats -> "Statistics"
    Issues -> "Issues"
    InterviewQuestions -> "Interview Questions"
    NotFound(..) -> "Page not found"
  }

  use _ <- effect.from
  meta.set_page_title(page_title <> " ・ Academy")
}

// Utils

fn route_effects(route: Route) -> effect.Effect(Message) {
  let data_effects = case route {
    Threads -> []
    Thread(ModmailThread(_, ..)) -> []
    Cases -> []
    Case(_) -> []
    Stats -> []
    Issues -> []
    InterviewQuestions -> [
      get_questions(),
    ]
    NotFound(..) -> []
  }

  effect.batch([set_title(route), ..data_effects])
}
